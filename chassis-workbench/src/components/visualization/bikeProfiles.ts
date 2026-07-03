/**
 * bikeProfiles.ts — Bike-type visual templates
 *
 * Each profile defines proportional geometry style for the 8 bike categories.
 * Derived from published geometry data:
 *   Sport    : Yamaha R1, Honda CBR, Ducati Panigale
 *   Naked    : MT-09, Z900, CB650
 *   ADV      : Africa Twin, GS1250, KTM 1290 Adv
 *   Cruiser  : Fat Boy, V-Max, Vulcan
 *   Touring  : GL1800, K1600, FJR1300
 *   Supermoto: Husqvarna 701, KTM 690 SM
 *   Dirt     : KTM 450EXC, YZF450
 *   Scooter  : TMAX, Forza 750
 */

export type BikeCategory =
  | 'sport' | 'naked' | 'adv' | 'cruiser'
  | 'touring' | 'supermoto' | 'dirt' | 'scooter';

/**
 * Handlebar silhouette type — controls how the handlebar is rendered in the
 * 2D side-profile view.
 *
 * clipOn     — Clip-ons: tight bracket directly on fork crown (sport)
 * standard   — Flat drag-bar or standard roadster bar
 * wide       — Wide flat cross-bar (supermoto, enduro — extends far in/out)
 * pullBack   — Swept pull-back bar (cruiser characteristic shape)
 * riser      — High-riser bar on tall riser bolts (ADV / adventure)
 * caf        — Flat tracker / café style — slightly forward sweep, low
 */
export type HandlebarType = 'clipOn' | 'standard' | 'wide' | 'pullBack' | 'riser' | 'caf';

/** Tyre cross-section specification for realistic profile rendering */
export interface TireSpec {
  /** Tyre section width (mm), e.g. 120 for a 120/70 ZR17 */
  frontWidth: number;
  /** Aspect ratio (%), e.g. 70 for a 120/70 */
  frontAspect: number;
  /** Rear tyre section width (mm) */
  rearWidth: number;
  /** Rear tyre aspect ratio (%) */
  rearAspect: number;
}

export interface BikeProfile {
  category: BikeCategory;
  label: string;
  /** Typical head angle range from vertical (degrees) */
  rakeRange: [number, number];
  /** Typical trail range (mm) */
  trailRange: [number, number];
  /** Typical wheelbase (mm) */
  wheelbaseRange: [number, number];
  /** Front/rear wheel diameter ratio (front/rear) — 1.0 = same */
  wheelRatio: number;
  /** Swingarm angle range (degrees, negative = axle below pivot) */
  swingarmAngleRange: [number, number];
  /** Seat height relative to wheelbase (fraction) */
  seatHeightFraction: number;
  /** CoG height relative to wheelbase (fraction) */
  cogHeightFraction: number;
  /**
   * Silhouette shape control points relative to wheelbase and wheel radius.
   * Defines the upper outline (tank + seat + tail) as a smooth polygon.
   * All values normalised: x in [0,1] front→rear, y in [0,1] ground→rideHeight.
   * These are multiplied by actual WB/maxH at render time.
   */
  outline: Array<[number, number]>;
  /** Visual accent colour */
  accentColor: string;
  /** Secondary colour (frame visible colour) */
  frameColor: string;
  /** Fairing type — affects how much bodywork is drawn */
  fairing: 'full' | 'half' | 'naked' | 'scrambler' | 'tall';
  /** Handlebar silhouette type for class-accurate 2D rendering */
  handlebarType: HandlebarType;
  /** Tyre cross-section data for accurate sidewall rendering */
  tireSpec: TireSpec;
}

const PROFILES: Record<BikeCategory, BikeProfile> = {
  sport: {
    category: 'sport',
    label: 'Sport / Supersport',
    rakeRange: [22, 25],
    trailRange: [90, 110],
    wheelbaseRange: [1380, 1420],
    wheelRatio: 1.06,
    swingarmAngleRange: [-3, -1],
    seatHeightFraction: 0.585,
    cogHeightFraction: 0.41,
    fairing: 'full',
    accentColor: '#e03131',
    frameColor: '#1971c2',
    handlebarType: 'clipOn',
    tireSpec: { frontWidth: 120, frontAspect: 70, rearWidth: 190, rearAspect: 55 },
    outline: [
      [0.03, 0.62], [0.08, 0.70], [0.18, 0.72], [0.30, 0.68],
      [0.42, 0.72], [0.55, 0.75], [0.68, 0.78], [0.76, 0.72],
      [0.82, 0.62], [0.87, 0.50], [0.90, 0.38], [0.88, 0.28],
    ],
  },
  naked: {
    category: 'naked',
    label: 'Naked / Roadster',
    rakeRange: [23, 27],
    trailRange: [100, 120],
    wheelbaseRange: [1395, 1450],
    wheelRatio: 1.0,
    swingarmAngleRange: [-4, -1],
    seatHeightFraction: 0.58,
    cogHeightFraction: 0.42,
    fairing: 'naked',
    accentColor: '#f76707',
    frameColor: '#495057',
    handlebarType: 'standard',
    tireSpec: { frontWidth: 120, frontAspect: 70, rearWidth: 180, rearAspect: 55 },
    outline: [
      [0.05, 0.50], [0.15, 0.60], [0.30, 0.65], [0.44, 0.68],
      [0.58, 0.72], [0.68, 0.74], [0.76, 0.72], [0.82, 0.62],
      [0.86, 0.50], [0.89, 0.38],
    ],
  },
  adv: {
    category: 'adv',
    label: 'Adventure / ADV',
    rakeRange: [25, 28],
    trailRange: [105, 125],
    wheelbaseRange: [1490, 1570],
    wheelRatio: 1.14,
    swingarmAngleRange: [-5, -2],
    seatHeightFraction: 0.63,
    cogHeightFraction: 0.46,
    fairing: 'tall',
    accentColor: '#2f9e44',
    frameColor: '#868e96',
    handlebarType: 'riser',
    tireSpec: { frontWidth: 110, frontAspect: 80, rearWidth: 150, rearAspect: 70 },
    outline: [
      [0.02, 0.68], [0.10, 0.78], [0.20, 0.82], [0.32, 0.78],
      [0.45, 0.80], [0.58, 0.82], [0.68, 0.84], [0.76, 0.80],
      [0.82, 0.70], [0.87, 0.58], [0.90, 0.44],
    ],
  },
  cruiser: {
    category: 'cruiser',
    label: 'Cruiser',
    rakeRange: [28, 35],
    trailRange: [120, 160],
    wheelbaseRange: [1560, 1700],
    wheelRatio: 1.0,
    swingarmAngleRange: [-6, -2],
    seatHeightFraction: 0.44,
    cogHeightFraction: 0.36,
    fairing: 'naked',
    accentColor: '#1864ab',
    frameColor: '#343a40',
    handlebarType: 'pullBack',
    tireSpec: { frontWidth: 130, frontAspect: 90, rearWidth: 180, rearAspect: 65 },
    outline: [
      [0.05, 0.48], [0.15, 0.54], [0.28, 0.56], [0.42, 0.60],
      [0.55, 0.58], [0.65, 0.60], [0.74, 0.58], [0.80, 0.52],
      [0.85, 0.42], [0.88, 0.32],
    ],
  },
  touring: {
    category: 'touring',
    label: 'Touring / Grand Tourer',
    rakeRange: [28, 32],
    trailRange: [110, 130],
    wheelbaseRange: [1490, 1570],
    wheelRatio: 1.0,
    swingarmAngleRange: [-4, -1],
    seatHeightFraction: 0.52,
    cogHeightFraction: 0.44,
    fairing: 'full',
    accentColor: '#5c7cfa',
    frameColor: '#4c6ef5',
    handlebarType: 'pullBack',
    tireSpec: { frontWidth: 120, frontAspect: 70, rearWidth: 180, rearAspect: 60 },
    outline: [
      [0.02, 0.70], [0.08, 0.82], [0.20, 0.86], [0.34, 0.80],
      [0.48, 0.78], [0.60, 0.80], [0.70, 0.82], [0.78, 0.78],
      [0.84, 0.68], [0.88, 0.55], [0.90, 0.42],
    ],
  },
  supermoto: {
    category: 'supermoto',
    label: 'Supermoto',
    rakeRange: [24, 27],
    trailRange: [105, 120],
    wheelbaseRange: [1450, 1510],
    wheelRatio: 1.0,
    swingarmAngleRange: [-6, -2],
    seatHeightFraction: 0.62,
    cogHeightFraction: 0.47,
    fairing: 'scrambler',
    accentColor: '#f03e3e',
    frameColor: '#f59f00',
    handlebarType: 'wide',
    tireSpec: { frontWidth: 110, frontAspect: 70, rearWidth: 150, rearAspect: 70 },
    outline: [
      [0.06, 0.60], [0.16, 0.68], [0.28, 0.70], [0.40, 0.68],
      [0.52, 0.72], [0.64, 0.76], [0.74, 0.76], [0.80, 0.70],
      [0.85, 0.58], [0.88, 0.46],
    ],
  },
  dirt: {
    category: 'dirt',
    label: 'Enduro / Off-Road',
    rakeRange: [26, 29],
    trailRange: [110, 130],
    wheelbaseRange: [1470, 1540],
    wheelRatio: 1.28,
    swingarmAngleRange: [-8, -3],
    seatHeightFraction: 0.70,
    cogHeightFraction: 0.50,
    fairing: 'scrambler',
    accentColor: '#f59f00',
    frameColor: '#f76707',
    handlebarType: 'wide',
    tireSpec: { frontWidth: 90, frontAspect: 90, rearWidth: 120, rearAspect: 80 },
    outline: [
      [0.06, 0.65], [0.14, 0.74], [0.24, 0.78], [0.36, 0.74],
      [0.48, 0.76], [0.60, 0.80], [0.70, 0.82], [0.78, 0.80],
      [0.84, 0.70], [0.88, 0.56], [0.90, 0.42],
    ],
  },
  scooter: {
    category: 'scooter',
    label: 'Scooter / Urban',
    rakeRange: [24, 28],
    trailRange: [90, 110],
    wheelbaseRange: [1520, 1600],
    wheelRatio: 1.0,
    swingarmAngleRange: [-4, 0],
    seatHeightFraction: 0.47,
    cogHeightFraction: 0.38,
    fairing: 'full',
    accentColor: '#0ca678',
    frameColor: '#20c997',
    handlebarType: 'standard',
    tireSpec: { frontWidth: 110, frontAspect: 70, rearWidth: 130, rearAspect: 70 },
    outline: [
      [0.04, 0.55], [0.12, 0.62], [0.22, 0.58], [0.32, 0.50],
      [0.44, 0.52], [0.56, 0.55], [0.66, 0.60], [0.74, 0.62],
      [0.80, 0.58], [0.85, 0.50], [0.88, 0.40],
    ],
  },
};

/** Detect bike category from family name */
export function detectCategory(familyName: string): BikeCategory {
  const n = familyName.toLowerCase();
  if (n.includes('sport') || n.includes('supersport')) return 'sport';
  if (n.includes('naked') || n.includes('roadster'))   return 'naked';
  if (n.includes('adv') || n.includes('adventure'))    return 'adv';
  if (n.includes('cruiser'))                           return 'cruiser';
  if (n.includes('touring') || n.includes('luxury'))   return 'touring';
  if (n.includes('supermoto'))                         return 'supermoto';
  if (n.includes('enduro') || n.includes('off-road') || n.includes('dirt')) return 'dirt';
  if (n.includes('scooter') || n.includes('urban'))   return 'scooter';
  return 'naked';
}

export function getProfile(cat: BikeCategory): BikeProfile {
  return PROFILES[cat];
}

export default PROFILES;
