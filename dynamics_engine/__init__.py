"""
dynamics_engine — Motorcycle Dynamics Simulation Package
=========================================================
A fully connected, DAG-based motorcycle physics model.

Quick start:
    from dynamics_engine import MotorcycleDynamicsModel, MassComponent

    model = MotorcycleDynamicsModel(preset='sport')
    model.set_input('swingarm_length', 620)
    model.print_report()

    sweep = model.sweep('swingarm_length', 500, 700, steps=20,
                        output_names=['wheelbase', 'x_cg', 'front_pct',
                                      'anti_squat_pct', 'wheelie_threshold_g'])
"""

from .motorcycle_dynamics import MotorcycleDynamicsModel, MassComponent, Parameter

__all__ = ['MotorcycleDynamicsModel', 'MassComponent', 'Parameter']
__version__ = '1.0.0'
