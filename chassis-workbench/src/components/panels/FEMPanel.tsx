import { useStore } from '../../store/useStore';
import type { FEMSectionParams } from '../../engine/types';

const MATERIALS = ['steel', 'aluminum', 'cfrp', 'titanium'] as const;

const DEFAULT_VALS: FEMSectionParams = {
  forkOD: 43, forkWall: 3,
  frameOD: 32, frameWall: 2.5,
  swingarmOD: 38, swingarmWall: 3,
  forkMaterial: 'aluminum',
  frameMaterial: 'steel',
  swingarmMaterial: 'aluminum',
};

function SliderRow({ label, field, min, max, step, unit }: {
  label: string;
  field: keyof Pick<FEMSectionParams, 'forkOD'|'forkWall'|'frameOD'|'frameWall'|'swingarmOD'|'swingarmWall'>;
  min: number; max: number; step: number; unit: string;
}) {
  const value = useStore(s => ((s.input.femSection as FEMSectionParams | undefined)?.[field] ?? DEFAULT_VALS[field])) as number;
  const set = useStore(s => s.setFEMSection);
  return (
    <div className="input-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set({ [field]: parseFloat(e.target.value) })} />
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e => set({ [field]: parseFloat(e.target.value) || 0 })} />
      <span className="unit">{unit}</span>
    </div>
  );
}

function MatSelect({ label, field }: {
  label: string;
  field: 'forkMaterial' | 'frameMaterial' | 'swingarmMaterial';
}) {
  const value = useStore(s => ((s.input.femSection as FEMSectionParams | undefined)?.[field] ?? DEFAULT_VALS[field])) as string;
  const set = useStore(s => s.setFEMSection);
  return (
    <div className="input-row">
      <label>{label}</label>
      <select value={value} onChange={e => set({ [field]: e.target.value as FEMSectionParams['forkMaterial'] })}
        style={{ flex: 1, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px' }}>
        {MATERIALS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
      </select>
    </div>
  );
}

export default function FEMPanel() {
  const fem = useStore(s => s.results.fem);

  return (
    <>
      <div className="section-title">Fork Section</div>
      <SliderRow label="Fork OD"   field="forkOD"   min={25} max={60} step={1}   unit="mm" />
      <SliderRow label="Fork Wall" field="forkWall" min={1}  max={8}  step={0.5} unit="mm" />
      <MatSelect label="Fork Material" field="forkMaterial" />

      <div className="section-title">Frame Section</div>
      <SliderRow label="Frame OD"   field="frameOD"   min={20} max={50} step={1}   unit="mm" />
      <SliderRow label="Frame Wall" field="frameWall" min={1}  max={6}  step={0.5} unit="mm" />
      <MatSelect label="Frame Material" field="frameMaterial" />

      <div className="section-title">Swingarm Section</div>
      <SliderRow label="Swingarm OD"   field="swingarmOD"   min={25} max={60} step={1}   unit="mm" />
      <SliderRow label="Swingarm Wall" field="swingarmWall" min={1}  max={6}  step={0.5} unit="mm" />
      <MatSelect label="Swingarm Material" field="swingarmMaterial" />

      <div className="section-title">FEM Results</div>
      {!fem.solved && (
        <div style={{ color: 'var(--danger)', fontSize: 11, padding: '4px 0' }}>
          ⚠ {fem.error ?? 'Solve failed'}
        </div>
      )}
      {fem.solved && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Max displacement: <b style={{ color: 'var(--text)' }}>{fem.maxDisplacement.toFixed(3)} mm</b>
            &nbsp;·&nbsp;Critical: <b style={{ color: 'var(--danger)' }}>{fem.criticalElement}</b>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '2px 4px' }}>Element</th>
                <th style={{ padding: '2px 4px' }}>σ (MPa)</th>
                <th style={{ padding: '2px 4px' }}>SF</th>
              </tr>
            </thead>
            <tbody>
              {fem.elements.map(el => (
                <tr key={el.id}>
                  <td style={{ padding: '2px 4px', color: 'var(--text)' }}>{el.label}</td>
                  <td style={{ padding: '2px 4px', color: el.stressColor }}>{el.combinedStress.toFixed(1)}</td>
                  <td style={{ padding: '2px 4px', background: el.stressColor + '22', color: el.stressColor, borderRadius: 3 }}>
                    {el.safetyFactor < 100 ? el.safetyFactor.toFixed(2) : '—'}
                    {el.safetyFactor < 1.5 && ' ⚠'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
