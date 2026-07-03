"""
tire_engine.py — Tire Physics Module
Port of: chassis-workbench/src/engine/tire.ts

References:
    Cossalter, V. (2006). Motorcycle Dynamics, 2nd Ed., Ch. 2.
    Pacejka, H. (2012). Tire and Vehicle Dynamics, Ch. 1.

Units: mm, N, kg, km/h, N/mm
"""

import math
from dataclasses import dataclass

K_GROWTH: float = 2e-6  # centrifugal growth coefficient [1/(m/s)²]


@dataclass
class TireInputs:
    front_section_width: float       # mm
    front_aspect_ratio: float        # %
    front_rim_diameter_inches: float # in
    front_tire_stiffness: float      # N/mm
    rear_section_width: float        # mm
    rear_aspect_ratio: float         # %
    rear_rim_diameter_inches: float  # in
    rear_tire_stiffness: float       # N/mm
    speed_kmh: float
    R_front_N: float                 # N
    R_rear_N: float                  # N
    wheel_rate_front: float          # N/mm
    wheel_rate_rear: float           # N/mm
    sprung_mass_front: float         # kg
    sprung_mass_rear: float          # kg


@dataclass
class TireResults:
    front_free_radius: float
    rear_free_radius: float
    front_deflection: float
    rear_deflection: float
    front_loaded_radius: float
    rear_loaded_radius: float
    front_contact_patch_mm: float
    rear_contact_patch_mm: float
    front_dynamic_radius: float
    rear_dynamic_radius: float
    front_combined_rate: float
    rear_combined_rate: float
    front_nat_freq_corrected: float
    rear_nat_freq_corrected: float


def compute_free_radius(section_width: float, aspect_ratio: float, rim_dia_inches: float) -> float:
    """R_free = rim_radius + sidewall_height"""
    return (rim_dia_inches * 25.4) / 2.0 + section_width * (aspect_ratio / 100.0)


def compute_tire_deflection(normal_load: float, k_tire: float) -> float:
    if k_tire < 1e-9:
        raise ValueError("k_tire must be > 0")
    return normal_load / k_tire


def compute_contact_patch(R_loaded: float, deflection: float) -> float:
    """Hertz: L = 2 × sqrt(2 × R_loaded × deflection)  [Cossalter Eq 2.1]"""
    if R_loaded < 1e-9 or deflection < 0.0:
        return 0.0
    return 2.0 * math.sqrt(2.0 * R_loaded * deflection)


def compute_dynamic_radius(R_free: float, speed_kmh: float) -> float:
    """R_dyn = R_free × (1 + K_GROWTH × V²)  [Cossalter Eq 2.4]"""
    V = speed_kmh / 3.6
    return R_free * (1.0 + K_GROWTH * V * V)


def compute_combined_rate(k_wheel: float, k_tire: float) -> float:
    """Series spring rate: 1/k_comb = 1/k_wheel + 1/k_tire"""
    if k_wheel < 1e-9 or k_tire < 1e-9:
        return min(k_wheel, k_tire)
    return (k_wheel * k_tire) / (k_wheel + k_tire)


def compute_corrected_nat_freq(k_combined: float, m_sprung: float) -> float:
    """f_n = (1/2π) × sqrt(k_combined × 1000 / m_sprung)"""
    if m_sprung < 1e-9:
        raise ValueError("m_sprung must be > 0")
    return (1.0 / (2.0 * math.pi)) * math.sqrt((k_combined * 1000.0) / m_sprung)


def compute_tire(inputs: TireInputs) -> TireResults:
    front_free = compute_free_radius(inputs.front_section_width, inputs.front_aspect_ratio, inputs.front_rim_diameter_inches)
    rear_free  = compute_free_radius(inputs.rear_section_width,  inputs.rear_aspect_ratio,  inputs.rear_rim_diameter_inches)

    front_defl = compute_tire_deflection(inputs.R_front_N, inputs.front_tire_stiffness)
    rear_defl  = compute_tire_deflection(inputs.R_rear_N,  inputs.rear_tire_stiffness)

    front_loaded = front_free - front_defl
    rear_loaded  = rear_free  - rear_defl

    front_cp = compute_contact_patch(front_loaded, front_defl)
    rear_cp  = compute_contact_patch(rear_loaded,  rear_defl)

    front_dyn = compute_dynamic_radius(front_free, inputs.speed_kmh)
    rear_dyn  = compute_dynamic_radius(rear_free,  inputs.speed_kmh)

    front_comb = compute_combined_rate(inputs.wheel_rate_front, inputs.front_tire_stiffness)
    rear_comb  = compute_combined_rate(inputs.wheel_rate_rear,  inputs.rear_tire_stiffness)

    front_fn = compute_corrected_nat_freq(front_comb, inputs.sprung_mass_front)
    rear_fn  = compute_corrected_nat_freq(rear_comb,  inputs.sprung_mass_rear)

    return TireResults(
        front_free_radius=front_free, rear_free_radius=rear_free,
        front_deflection=front_defl, rear_deflection=rear_defl,
        front_loaded_radius=front_loaded, rear_loaded_radius=rear_loaded,
        front_contact_patch_mm=front_cp, rear_contact_patch_mm=rear_cp,
        front_dynamic_radius=front_dyn, rear_dynamic_radius=rear_dyn,
        front_combined_rate=front_comb, rear_combined_rate=rear_comb,
        front_nat_freq_corrected=front_fn, rear_nat_freq_corrected=rear_fn,
    )


if __name__ == "__main__":
    inp = TireInputs(
        front_section_width=120, front_aspect_ratio=70, front_rim_diameter_inches=17,
        front_tire_stiffness=180, rear_section_width=190, rear_aspect_ratio=55,
        rear_rim_diameter_inches=17, rear_tire_stiffness=200, speed_kmh=100,
        R_front_N=952, R_rear_N=789, wheel_rate_front=8.94, wheel_rate_rear=37.2,
        sprung_mass_front=78, sprung_mass_rear=65,
    )
    r = compute_tire(inp)
    print(f"Front free radius:      {r.front_free_radius:.2f} mm")
    print(f"Rear  free radius:      {r.rear_free_radius:.2f} mm")
    print(f"Front deflection:       {r.front_deflection:.3f} mm")
    print(f"Rear  deflection:       {r.rear_deflection:.3f} mm")
    print(f"Front contact patch:    {r.front_contact_patch_mm:.2f} mm")
    print(f"Rear  contact patch:    {r.rear_contact_patch_mm:.2f} mm")
    print(f"Front dynamic radius:   {r.front_dynamic_radius:.2f} mm  @{inp.speed_kmh} km/h")
    print(f"Rear  dynamic radius:   {r.rear_dynamic_radius:.2f} mm  @{inp.speed_kmh} km/h")
    print(f"Front combined rate:    {r.front_combined_rate:.4f} N/mm")
    print(f"Rear  combined rate:    {r.rear_combined_rate:.4f} N/mm")
    print(f"Front fn corrected:     {r.front_nat_freq_corrected:.4f} Hz")
    print(f"Rear  fn corrected:     {r.rear_nat_freq_corrected:.4f} Hz")
    print("tire_engine OK")
