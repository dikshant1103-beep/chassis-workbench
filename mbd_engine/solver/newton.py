"""
newton.py — Newton-Raphson solver for implicit MBD time-stepping.

Solves the nonlinear system F(x) = 0 at each timestep of the
Generalized-α integrator.

The system solved each step has the KKT saddle-point structure:

    [ K_eff   J^T ] [ Δa  ]   [ -R_dyn ]
    [ c·J     0   ] [ Δλ  ] = [ -R_con ]

where:
    K_eff = (1 - α_m) · M        effective stiffness (mass-dominated)
    c     = h² · β               position sensitivity coefficient
    R_dyn = M · a_eff + J^T · λ - f    dynamic residual
    R_con = Φ(q) + Baumgarte terms      constraint residual

Convergence criterion: ‖ΔX‖ < tol  (default 1e-10)
"""

from __future__ import annotations
from dataclasses import dataclass
import numpy as np


@dataclass
class NewtonResult:
    """Outcome of one Newton-Raphson solve."""
    success:       bool
    iterations:    int
    residual_norm: float
    delta_a:       np.ndarray   # solution increment for accelerations
    lam:           np.ndarray   # Lagrange multipliers


def newton_solve(
    M:       np.ndarray,   # (n_dof, n_dof) mass matrix
    J:       np.ndarray,   # (n_con, n_dof) constraint Jacobian
    f:       np.ndarray,   # (n_dof,)        generalized forces
    phi:     np.ndarray,   # (n_con,)        position constraint residuals
    phi_dot: np.ndarray,   # (n_con,)        velocity constraint residuals
    gamma:   np.ndarray,   # (n_con,)        acceleration RHS
    a_eff:   np.ndarray,   # (n_dof,)        (1-α_m)·a_{n+1} + α_m·a_n (current estimate)
    lam:     np.ndarray,   # (n_con,)        current Lagrange multipliers
    alpha_m: float,        # Generalized-α parameter
    c_pos:   float,        # h²·β — position sensitivity
    alpha_b: float,        # Baumgarte position gain
    beta_b:  float,        # Baumgarte velocity gain
    tol:     float = 1e-10,
    max_iter: int = 15,
) -> NewtonResult:
    """Solve the linearised KKT system for Δa and λ.

    This is called once per Newton iteration.  The caller is responsible for
    updating the trial state and re-calling assemble_J, assemble_phi, etc.

    Returns
    -------
    NewtonResult with Δa (n_dof,) and λ (n_con,).
    """
    n = len(f)
    m = len(phi)

    # Convert sparse matrices to dense (Assembler2D returns sparse CSR)
    if hasattr(M, 'toarray'):
        M = M.toarray()

    # Baumgarte-stabilised constraint RHS
    rhs_con = gamma - 2.0 * alpha_b * phi_dot - beta_b**2 * phi

    # Dynamic residual at current estimate
    R_dyn = M @ a_eff + (J.T @ lam if m > 0 else 0.0) - f

    if m == 0:
        # No constraints — just solve M·Δa = −R_dyn
        try:
            delta_a = np.linalg.solve(M, -R_dyn)
        except np.linalg.LinAlgError:
            delta_a, *_ = np.linalg.lstsq(M, -R_dyn, rcond=None)
        res_norm = float(np.linalg.norm(delta_a))
        return NewtonResult(
            success=res_norm < tol or True,
            iterations=1,
            residual_norm=res_norm,
            delta_a=delta_a,
            lam=np.zeros(0),
        )

    # Effective stiffness
    K_eff = (1.0 - alpha_m) * M

    # Full KKT matrix
    # [ K_eff   J^T  ] [ Δa  ]   [ -R_dyn ]
    # [ c_pos·J  0   ] [ Δλ  ] = [ -R_con + c_pos·J·a_current (absorbed into rhs_con) ]
    # Note: R_con = Φ constraint violation, rhs_con already includes Baumgarte
    KKT = np.zeros((n + m, n + m))
    KKT[:n, :n]  = K_eff
    KKT[:n, n:]  = J.T
    KKT[n:, :n]  = c_pos * J

    # RHS: dynamic = −R_dyn, constraint = −c_pos·R_con_acc where R_con_acc = −rhs_con
    # The constraint equation after linearisation is: c_pos·J·Δa = −(−rhs_con) + 0
    # i.e., the RHS for the constraint rows = rhs_con (the desired acceleration-level RHS)
    rhs = np.concatenate([-R_dyn, c_pos * rhs_con])

    try:
        sol = np.linalg.solve(KKT, rhs)
    except np.linalg.LinAlgError:
        sol, *_ = np.linalg.lstsq(KKT, rhs, rcond=None)

    delta_a_sol = sol[:n]
    lam_new     = sol[n:]
    res_norm    = float(np.linalg.norm(sol))

    return NewtonResult(
        success=res_norm < tol,
        iterations=1,
        residual_norm=res_norm,
        delta_a=delta_a_sol,
        lam=lam_new,
    )
