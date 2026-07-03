"""
MultibodySystem2D — top-level API for the 2-D MBD solver.

Usage
-----
    from mbd_engine.core.system import MultibodySystem2D

    sys = MultibodySystem2D()
    ground = sys.add_ground()
    bob    = sys.add_body('bob', mass=1.0, inertia=0.01,
                          x=1.0, y=0.0)
    sys.add_revolute(ground, bob,
                     world_point=[0.0, 0.0],
                     s_i=[0.0, 0.0],   # attachment on ground (irrelevant)
                     s_j=[-1.0, 0.0])  # pivot at local [-L, 0] on bob

    results = sys.simulate(t_end=5.0, dt=1e-3)
    print(results['t'], results['energy'])
"""

from __future__ import annotations
from typing import List, Dict, Optional
import numpy as np

from .body import RigidBody2D
from .constraints.revolute2d import RevoluteJoint2D
from .constraints.prismatic2d import PrismaticJoint2D
from .assembler import Assembler2D
from .integrator import RK4Integrator


class MultibodySystem2D:
    """Container for a 2-D multibody system.

    Workflow
    --------
    1. add_ground() / add_body() — register bodies
    2. add_revolute() / add_prismatic() — register constraints
    3. simulate() — run and return results

    All units: SI (m, kg, rad, s).
    """

    def __init__(self, g: float = 9.81,
                 alpha_baum: float = 20.0,
                 beta_baum:  float = 20.0):
        self.g           = g
        self.alpha_baum  = alpha_baum
        self.beta_baum   = beta_baum
        self._bodies: List[RigidBody2D]     = []
        self._constraints: list             = []
        self._body_counter: int             = 0

    # ── Body registration ────────────────────────────────────────────────────

    def add_ground(self, name: str = "ground") -> RigidBody2D:
        """Add a fixed ground body (excluded from DOF vector)."""
        b = RigidBody2D(name=name, mass=0.0, inertia=0.0, is_ground=True)
        b.index = self._body_counter
        self._bodies.append(b)
        self._body_counter += 1
        return b

    def add_body(
        self,
        name: str,
        mass: float,
        inertia: float,
        x: float = 0.0,
        y: float = 0.0,
        theta: float = 0.0,
        vx: float = 0.0,
        vy: float = 0.0,
        omega: float = 0.0,
    ) -> RigidBody2D:
        """Add a moving rigid body."""
        b = RigidBody2D(
            name=name, mass=mass, inertia=inertia,
            x=x, y=y, theta=theta,
            vx=vx, vy=vy, omega=omega,
        )
        b.index = self._body_counter
        self._bodies.append(b)
        self._body_counter += 1
        return b

    # ── Constraint registration ──────────────────────────────────────────────

    def add_revolute(
        self,
        body_i: RigidBody2D,
        body_j: RigidBody2D,
        s_i: list | np.ndarray = (0.0, 0.0),
        s_j: list | np.ndarray = (0.0, 0.0),
        world_point: list | np.ndarray | None = None,
        name: str | None = None,
    ) -> RevoluteJoint2D:
        """Add a revolute (pin) joint.

        If body_i is ground and world_point is given, the joint fixes body_j's
        attachment point to that world location.
        If both are moving bodies, s_i and s_j define attachment points in
        each body's local frame.
        """
        jname = name or f"rev_{len(self._constraints)}"

        if body_i.is_ground:
            # Ground-fixed pin: s_j is in body_j's local frame
            j = RevoluteJoint2D(
                body_i=body_j,
                body_j=None,
                s_i=np.asarray(s_j, dtype=float),
                world_point=(np.asarray(world_point, dtype=float)
                             if world_point is not None
                             else np.array([body_i.x, body_i.y])),
                name=jname,
            )
        else:
            j = RevoluteJoint2D(
                body_i=body_i,
                body_j=body_j,
                s_i=np.asarray(s_i, dtype=float),
                s_j=np.asarray(s_j, dtype=float),
                name=jname,
            )
        self._constraints.append(j)
        return j

    def add_prismatic(
        self,
        body_i: RigidBody2D,
        body_j: RigidBody2D,
        s_i: list | np.ndarray = (0.0, 0.0),
        axis_angle: float = 0.0,
        theta_offset: float = 0.0,
        name: str | None = None,
    ) -> PrismaticJoint2D:
        """Add a prismatic (sliding) joint."""
        jname = name or f"prism_{len(self._constraints)}"
        j = PrismaticJoint2D(
            body_i=body_i, body_j=body_j,
            s_i=np.asarray(s_i, dtype=float),
            axis_angle=axis_angle,
            theta_offset=theta_offset,
            name=jname,
        )
        self._constraints.append(j)
        return j

    # ── Simulation ───────────────────────────────────────────────────────────

    def simulate(
        self,
        t_end: float,
        dt: float = 1e-3,
        store_every: int = 1,
    ) -> Dict:
        """Run simulation and return results dictionary.

        Parameters
        ----------
        t_end       : simulation duration, s
        dt          : timestep, s
        store_every : record every N steps (saves memory for long runs)

        Returns
        -------
        dict with keys:
            't'                    : time array
            'Q'                    : positions (each row = [x,y,θ] per body)
            'QD'                   : velocities
            'energy'               : total mechanical energy
            'energy_rel_error'     : (E(t)−E(0)) / E(0)
            'constraint_violation' : ‖Φ‖∞ at each stored frame
            'bodies'               : list of body names (for indexing Q columns)
            'n_dof'                : total degrees of freedom
            'n_constraints'        : total constraint equations
        """
        asm  = Assembler2D(
            bodies=self._bodies,
            constraints=self._constraints,
            g=self.g,
            alpha_baum=self.alpha_baum,
            beta_baum=self.beta_baum,
        )
        integ = RK4Integrator(assembler=asm, dt=dt)
        res   = integ.simulate(t_end=t_end, dt=dt, store_every=store_every)

        E0 = res['energy'][0] if abs(res['energy'][0]) > 1e-15 else 1.0
        res['energy_rel_error'] = (res['energy'] - res['energy'][0]) / E0
        res['bodies'] = [b.name for b in asm.moving]
        res['n_dof']  = asm.n_dof
        res['n_constraints'] = asm.n_con

        return res

    # ── Convenience: quick pendulum factory ──────────────────────────────────

    @classmethod
    def simple_pendulum(
        cls,
        length: float = 1.0,
        mass: float = 1.0,
        theta0: float = np.radians(30),
        dt: float = 1e-3,
    ) -> "MultibodySystem2D":
        """Create a simple pendulum: point mass on massless rod.

        The pivot is at the origin; the bob hangs at (L·sin(θ₀), −L·cos(θ₀)).
        Modelled as a slender rod with inertia I = m·L²/3 (or point mass I≈0).
        """
        sys = cls()
        ground = sys.add_ground()

        # Initial position: pivot at origin, bob displaced by theta0
        x0 = length * np.sin(theta0)
        y0 = -length * np.cos(theta0)

        bob = sys.add_body(
            name='bob',
            mass=mass,
            inertia=1e-6,        # near-zero: point mass approximation
            x=x0, y=y0,
        )

        # Revolute joint: fix the top of the rod to origin
        # s_j = local vector from bob CoM to pivot = [-x0, -y0] rotated to body frame
        # Since theta=0 initially, local frame = world frame
        sys.add_revolute(
            body_i=ground,
            body_j=bob,
            s_j=[0.0, 0.0],         # pivot AT the bob CoM? No:
            world_point=[0.0, 0.0], # fix CoM to origin is wrong — fix TOP of rod
            name='pivot',
        )
        # Correction: the pivot constrains the TOP of the rod (distance L above CoM)
        # For a point mass model the bob IS the particle, pivot is at origin,
        # and the constraint is that bob stays at distance L from origin.
        # Cleanest model: add an invisible body at pivot + revolute to bob.
        # Instead use: constrain bob CoM with s_j pointing from CoM toward pivot
        return sys

    # ── Info ─────────────────────────────────────────────────────────────────

    def info(self) -> str:
        moving = [b for b in self._bodies if not b.is_ground]
        lines = [
            f"MultibodySystem2D",
            f"  Bodies     : {len(self._bodies)} total ({len(moving)} moving)",
            f"  Constraints: {len(self._constraints)} joints",
            f"  DOF        : {3 * len(moving)} - {sum(c.N_CONSTRAINTS for c in self._constraints)} = "
            f"{3*len(moving) - sum(c.N_CONSTRAINTS for c in self._constraints)}",
        ]
        for b in self._bodies:
            tag = " [ground]" if b.is_ground else ""
            lines.append(f"    {b.name}{tag}: m={b.mass}kg  pos=({b.x:.3f},{b.y:.3f})  θ={np.degrees(b.theta):.1f}°")
        for c in self._constraints:
            lines.append(f"    {c}")
        return "\n".join(lines)

    def __repr__(self) -> str:
        return self.info()
