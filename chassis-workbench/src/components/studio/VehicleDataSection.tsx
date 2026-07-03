/** VehicleDataSection — Studio Section 1: masses, weight distribution, wheels. */
import { Section, PanelRow, SelectRow } from '../panels/PanelShared';
import { StudioVehicle, BikeCategory } from '../../engine/studio/types';

const CATEGORIES: { val: BikeCategory; label: string }[] = [
  { val: 'sport', label: 'Sport' }, { val: 'naked', label: 'Naked' },
  { val: 'adv', label: 'ADV' }, { val: 'cruiser', label: 'Cruiser' },
  { val: 'touring', label: 'Touring' }, { val: 'supermoto', label: 'Supermoto' },
  { val: 'enduro', label: 'Enduro' }, { val: 'scooter', label: 'Scooter' },
];

export default function VehicleDataSection({ vehicle, onChange }: {
  vehicle: StudioVehicle;
  onChange: (patch: Partial<StudioVehicle>) => void;
}) {
  return (
    <Section icon="⊙" title="1 · Vehicle Data" summary={`${(vehicle.vehicleMass + vehicle.riderMass).toFixed(0)} kg`}>
      <SelectRow label="Bike category" value={vehicle.category}
        options={CATEGORIES.map(c => ({ val: c.val, label: c.label }))}
        onChange={v => onChange({ category: v as BikeCategory })} />
      <PanelRow label="Vehicle mass (wet)" value={vehicle.vehicleMass} min={50} max={500} step={1} unit="kg"
        onChange={v => onChange({ vehicleMass: v })} />
      <PanelRow label="Rider mass" value={vehicle.riderMass} min={30} max={150} step={1} unit="kg"
        onChange={v => onChange({ riderMass: v })} />
      <PanelRow label="Passenger mass" value={vehicle.passengerMass} min={0} max={120} step={1} unit="kg"
        onChange={v => onChange({ passengerMass: v })} />
      <PanelRow label="Cargo / luggage" value={vehicle.cargoMass} min={0} max={80} step={1} unit="kg"
        onChange={v => onChange({ cargoMass: v })} />
      <PanelRow label="Unsprung — front" value={vehicle.unsprungFront} min={3} max={30} step={0.5} unit="kg"
        onChange={v => onChange({ unsprungFront: v })} />
      <PanelRow label="Unsprung — rear" value={vehicle.unsprungRear} min={4} max={35} step={0.5} unit="kg"
        onChange={v => onChange({ unsprungRear: v })} />
      <PanelRow label="Front weight distribution" value={vehicle.frontWeightPct} min={35} max={65} step={0.5} unit="%"
        desc="Static % of laden weight on the front axle"
        onChange={v => onChange({ frontWeightPct: v })} />
      <PanelRow label="Wheelbase" value={vehicle.wheelbase} min={1000} max={1800} step={1} unit="mm"
        onChange={v => onChange({ wheelbase: v })} />
      <PanelRow label="Front wheel Ø" value={vehicle.frontWheelDia} min={250} max={800} step={1} unit="mm"
        onChange={v => onChange({ frontWheelDia: v })} />
      <PanelRow label="Rear wheel Ø" value={vehicle.rearWheelDia} min={250} max={800} step={1} unit="mm"
        onChange={v => onChange({ rearWheelDia: v })} />
    </Section>
  );
}
