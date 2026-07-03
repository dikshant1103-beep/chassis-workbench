"""
system3d.py — Top-level MultibodySystem3D API.

Mirrors the MultibodySystem2D interface from system.py.
"""

from __future__ import annotations
from typing import Dict, List
import numpy as np

from .body import RigidBody3D
from .assembler3d import Assembler3D
from .integrator3d import RK4Integrator3D


class MultibodySystem3D:
    """High-level API for building and simulating 3-D multibody systems.

    Example
    -------
    sys = MultibodySystem3D(g=9.81)
    ground = sys.add_body(RigidBody3D('ground', mass=1e10, I_body=[1e10]*3, is_ground=True))
    link   = sys.add_body(RigidBody3D('link', mass=1.0, I_body=[0.01, 0.01, 0.001],
                                       x=0.5, y=0.0, z=0.0,
                                       qw=..., vx=0.0, ...))
    joint  = RevoluteJoint3D(ground, link, [0,0,0], [-0.5,0,0], [0,0,1])
    sys.add_joint(joint)
    results = sys.simulate(t_end=2.0, dt=1e-3)
    """

    def __init__(self, g: float = 9.81, alpha_baum: float = 20.0, beta_baum: float = 20.0):
        self.g = g
        self.alpha = alpha_baum
        self.beta  = beta_baum
        self._bodies: List[RigidBody3D] = []
        self._joints: list = []
        self._asm: Assembler3D | None = None

    def add_body(self, body: RigidBody3D) -> RigidBody3D:
        self._bodies.append(body)
        self._asm = None   # invalidate cached assembler
        return body

    def add_joint(self, joint) -> None:
        self._joints.append(joint)
        self._asm = None

    def _get_assembler(self) -> Assembler3D:
        if self._asm is None:
            self._asm = Assembler3D(
                self._bodies, self._joints,
                g=self.g, alpha_baum=self.alpha, beta_baum=self.beta,
            )
        return self._asm

    def simulate(
        self,
        t_end: float,
        dt: float = 1e-3,
        store_every: int = 1,
    ) -> Dict:
        """Run simulation from t=0 to t=t_end.

        Parameters
        ----------
        t_end       : end time, s
        dt          : timestep, s
        store_every : store results every N steps

        Returns
        -------
        dict — same keys as RK4Integrator3D.simulate()
        """
        asm = self._get_assembler()
        integrator = RK4Integrator3D(asm, dt=dt)
        return integrator.simulate(t_end=t_end, store_every=store_every)
