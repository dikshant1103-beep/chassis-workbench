/**
 * CustomBikeModal.tsx — Create or edit a custom bike entry.
 *
 * When creating: user picks a base preset, gives it a name + description.
 * The base preset params are deep-cloned into the new custom bike.
 * The modal then loads the custom bike into the workbench so the user
 * can tweak parameters on the normal input tabs.
 *
 * When editing: just rename / re-describe, or overwrite params with current.
 */

import { useState } from 'react';
import { FAMILIES } from '../../data/families';
import { useStore, CustomBike } from '../../store/useStore';
import { ComputeAllInput } from '../../engine/types';

interface Props {
  /** If set, we are editing an existing custom bike (rename/update) */
  editing?: CustomBike;
  onClose: () => void;
}

const MODAL_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999,
};

const MODAL_BOX: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 24, width: 420, maxWidth: '95vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

const FIELD_STYLE: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 12, borderRadius: 5,
  padding: '6px 10px', boxSizing: 'border-box', marginBottom: 10,
};

const BTN = (accent = false): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 5, border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
  background: accent ? 'var(--accent)' : 'var(--surface2)',
  color: accent ? '#fff' : 'var(--text)',
});

export default function CustomBikeModal({ editing, onClose }: Props) {
  const currentInput    = useStore(s => s.input);
  const saveCustomBike  = useStore(s => s.saveCustomBike);
  const updateCustomBike = useStore(s => s.updateCustomBike);
  const renameCustomBike = useStore(s => s.renameCustomBike);
  const loadCustomBike  = useStore(s => s.loadCustomBike);

  const [name, setName]   = useState(editing?.name ?? '');
  const [desc, setDesc]   = useState(editing?.description ?? '');
  const [base, setBase]   = useState(FAMILIES[0].name);
  const [fromCurrent, setFromCurrent] = useState(!editing);

  const isEditing = !!editing;

  function handleCreate() {
    if (!name.trim()) return;
    let inputSrc: ComputeAllInput;
    if (fromCurrent) {
      inputSrc = currentInput;
    } else {
      const preset = FAMILIES.find(f => f.name === base) ?? FAMILIES[0];
      inputSrc = preset.input;
    }
    const id = saveCustomBike(name.trim(), desc.trim(), inputSrc);
    loadCustomBike(id);
    onClose();
  }

  function handleUpdateParams() {
    if (!editing) return;
    updateCustomBike(editing.id, currentInput);
    onClose();
  }

  function handleRename() {
    if (!editing || !name.trim()) return;
    renameCustomBike(editing.id, name.trim(), desc.trim());
    onClose();
  }

  return (
    <div style={MODAL_OVERLAY} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL_BOX}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            {isEditing ? `Edit — ${editing.name}` : 'New Custom Bike'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Name *</label>
        <input style={FIELD_STYLE} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. SM Race Spec 2024" maxLength={48} />

        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Description</label>
        <input style={FIELD_STYLE} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. 450cc SM, race suspension, 130/80-17" maxLength={80} />

        {!isEditing && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, marginTop: 4 }}>Starting Parameters</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' }}>
                <input type="radio" checked={fromCurrent} onChange={() => setFromCurrent(true)} />
                Copy current workbench
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' }}>
                <input type="radio" checked={!fromCurrent} onChange={() => setFromCurrent(false)} />
                From preset
              </label>
            </div>
            {!fromCurrent && (
              <select style={FIELD_STYLE} value={base} onChange={e => setBase(e.target.value)}>
                {FAMILIES.map(f => <option key={f.name} value={f.name}>{f.name} — {f.description}</option>)}
              </select>
            )}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
              After creating, the bike loads into the workbench. Use the input tabs to customise parameters,
              then use "Update Custom" in the header to save your changes.
            </div>
          </>
        )}

        {isEditing && (
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
            Rename / re-describe without changing parameters, or overwrite the stored parameters with the current workbench state.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={BTN(false)} onClick={onClose}>Cancel</button>
          {isEditing ? (
            <>
              <button style={BTN(false)} onClick={handleUpdateParams} title="Overwrite stored params with current workbench state">
                Overwrite Params
              </button>
              <button style={BTN(true)} onClick={handleRename} disabled={!name.trim()}>
                Rename
              </button>
            </>
          ) : (
            <button style={BTN(true)} onClick={handleCreate} disabled={!name.trim()}>
              Create & Load
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
