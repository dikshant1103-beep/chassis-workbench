import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from './store/useStore';
import { FAMILIES } from './data/families';
import { useBackendSync } from './hooks/useBackendSync';

// ── Electron bridge (only available in desktop app) ──────────────────────────
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getInfo: () => Promise<{ version: string; platform: string; backendReady: boolean; apiBase: string }>;
      backendStatus: () => Promise<{ ready: boolean; apiBase: string }>;
      openFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
      saveFile: (filters?: { name: string; extensions: string[] }[], defaultPath?: string) => Promise<string | null>;
      readFile: (path: string) => Promise<string | null>;
      writeFile: (path: string, content: string) => Promise<boolean>;
      saveConfig: (data: unknown) => void;
      onConfigLoad: (cb: (data: unknown) => void) => void;
      onConfigSaveRequest: (cb: () => void) => void;
      onExportCSV: (cb: () => void) => void;
      onBackendReady: (cb: (info: { apiBase: string }) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
import GeometryPanel from './components/panels/GeometryPanel';
import MassPanel from './components/panels/MassPanel';
import SuspensionPanel from './components/panels/SuspensionPanel';
import ChainPanel from './components/panels/ChainPanel';
import ErgoPanel from './components/panels/ErgoPanel';
import DynamicsPanel from './components/panels/DynamicsPanel';
import GraphsPanel from './components/panels/GraphsPanel';
import ResultsPanel from './components/results/ResultsPanel';
// EngineeringSVG replaced by ChassisViz2D — kept for reference only
import ComparePanel from './components/compare/ComparePanel';
import AIChatPanel from './components/ai/AIChatPanel';
import Chassis3D from './components/scene3d/Chassis3D';
import OverviewPanel from './components/overview/OverviewPanel';
import MBDPanel from './components/mbd/MBDPanel';
import ChassisSweepPanel from './components/panels/ChassisSweepPanel';
import AntiSquatPanel from './components/panels/AntiSquatPanel';
import ChassisDynamicsPanel from './components/panels/ChassisDynamicsPanel';
import ChassisViz2D from './components/visualization/ChassisViz2D';
import SweepComparePanel from './components/compare/SweepComparePanel';
import CustomBikeModal from './components/custom/CustomBikeModal';
import AntiDiveDashboard from './components/panels/AntiDiveDashboard';
import SystemPanel from './components/panels/SystemPanel';
import TirePanel from './components/panels/TirePanel';
import InertiaPanel from './components/panels/InertiaPanel';
import StabilityPanel from './components/panels/StabilityPanel';
import ForkCompliancePanel from './components/panels/ForkCompliancePanel';
import AeroPanel from './components/panels/AeroPanel';
import TargetsPanel from './components/panels/TargetsPanel';
import SensitivityPanel from './components/panels/SensitivityPanel';
import OptimizerPanel from './components/panels/OptimizerPanel';
import MonteCarloPanel from './components/panels/MonteCarloPanel';
import DesignJournalPanel from './components/panels/DesignJournalPanel';
import LoadEnvelopePanel from './components/panels/LoadEnvelopePanel';
import LoadCasesPanel from './components/panels/LoadCasesPanel';
import StiffnessTargetsPanel from './components/panels/StiffnessTargetsPanel';
import RideQualityPanel from './components/panels/RideQualityPanel';
import SuspensionDesignStudio from './components/studio/SuspensionDesignStudio';
import { useTheme } from './store/useTheme';
import { useAuth } from './auth/AuthContext';

const TABS = ['Overview', 'Geometry', 'Mass', 'Suspension', 'Chain', 'Ergo', 'Dynamics', 'Graphs', '3D', 'Compare', 'Simulator', 'Chassis Sim', 'Anti-Squat', 'Chassis Dynamics', 'Sweep Compare', 'Anti-Dive', 'System', 'Tire', 'Inertia', 'Stability', 'Fork', 'Aero', 'Targets', 'Sensitivity', 'Optimizer', 'Monte Carlo', 'Design Journal', 'Load Envelope', 'Ride Quality', 'Suspension Design Studio', 'Load Cases', 'Stiffness Targets'] as const;
type Tab = typeof TABS[number];

const TAB_META: Record<Tab, { icon: string; color: string; shortcut?: string }> = {
  Overview:   { icon: '◈', color: 'var(--cyan)',    shortcut: '1' },
  Geometry:   { icon: '△', color: 'var(--accent)',  shortcut: '2' },
  Mass:       { icon: '⊙', color: 'var(--accent)',  shortcut: '3' },
  Suspension: { icon: '≈', color: 'var(--accent)',  shortcut: '4' },
  Chain:      { icon: '⚙', color: 'var(--accent)',  shortcut: '5' },
  Ergo:       { icon: '⊓', color: 'var(--accent)',  shortcut: '6' },
  Dynamics:   { icon: '⊗', color: 'var(--accent)',  shortcut: '7' },
  Graphs:     { icon: '∿', color: 'var(--accent2)', shortcut: '8' },
  '3D':       { icon: '◺', color: '#f78166',        shortcut: '9' },
  Compare:    { icon: '⇔', color: 'var(--purple)',   shortcut: '' },
  Simulator:    { icon: '⟳', color: 'var(--cyan)',    shortcut: '' },
  'Chassis Sim': { icon: '≋', color: 'var(--accent2)', shortcut: '' },
  'Anti-Squat':         { icon: '◆', color: 'var(--accent)',  shortcut: '' },
  'Chassis Dynamics':   { icon: '⊕', color: 'var(--cyan)',   shortcut: '' },
  'Sweep Compare':      { icon: '⇔', color: 'var(--purple)', shortcut: '' },
  'Anti-Dive':          { icon: '↓', color: 'var(--cyan)',   shortcut: '' },
  'System':             { icon: '⊞', color: '#e8b44a',      shortcut: '' },
  'Tire':              { icon: '◎', color: 'var(--accent)',  shortcut: '' },
  'Inertia':           { icon: '↻', color: 'var(--accent2)', shortcut: '' },
  'Stability':         { icon: '⊿', color: 'var(--warn)',    shortcut: '' },
  'Fork':              { icon: '⌥', color: 'var(--accent)',  shortcut: '' },
  'Aero':              { icon: '⊳', color: 'var(--cyan)',    shortcut: '' },
  'Targets':           { icon: '◎', color: 'var(--accent2)', shortcut: '' },
  'Sensitivity':       { icon: '∂', color: 'var(--purple)',  shortcut: '' },
  'Optimizer':         { icon: '⌖', color: 'var(--accent2)', shortcut: '' },
  'Monte Carlo':       { icon: '🎲', color: 'var(--cyan)',   shortcut: '' },
  'Design Journal':    { icon: '📋', color: 'var(--purple)', shortcut: '' },
  'Load Envelope':     { icon: '⚡', color: 'var(--warn)',   shortcut: '' },
  'Ride Quality':      { icon: '〰', color: 'var(--cyan)',   shortcut: '' },
  'Suspension Design Studio': { icon: '✦', color: 'var(--accent2)', shortcut: '' },
  'Load Cases':        { icon: '⊟', color: 'var(--danger)', shortcut: '' },
  'Stiffness Targets': { icon: '⊺', color: 'var(--accent2)', shortcut: '' },
};

const INPUT_PANELS: Partial<Record<Tab, React.ReactElement>> = {
  Geometry:   <GeometryPanel />,
  Mass:       <MassPanel />,
  Suspension: <SuspensionPanel />,
  Chain:      <ChainPanel />,
  Ergo:       <ErgoPanel />,
  Dynamics:   <DynamicsPanel />,
  Tire:       <TirePanel />,
  Stability:  <StabilityPanel />,
  Fork:       <ForkCompliancePanel />,
};

// ── Full-width top tab bar ─────────────────────────────────────────────────
function TopTabBar({ activeTab, setActiveTab }: { activeTab: Tab; setActiveTab: (t: Tab) => void }) {
  return (
    <div className="top-tabbar">
      {TABS.map(t => {
        const { icon, color } = TAB_META[t];
        const active = activeTab === t;
        return (
          <button
            key={t}
            className={`top-tab${active ? ' active' : ''}`}
            style={active ? { '--tab-color': color } as React.CSSProperties : {}}
            onClick={() => setActiveTab(t)}
            title={t}
          >
            <span className="top-tab-icon" style={{ color: active ? color : undefined }}>{icon}</span>
            <span className="top-tab-label">{t}</span>
            {active && <span className="top-tab-bar" style={{ background: color }} />}
          </button>
        );
      })}
    </div>
  );
}

// ── Backend status badge ─────────────────────────────────────────────────────
// Reads live status from Zustand store; works in both Electron and browser.
function BackendBadge() {
  const status = useStore(s => s.backendStatus);

  const dot: Record<string, string> = {
    synced:  'var(--accent2)',
    syncing: 'var(--warn)',
    error:   '#f85149',
    offline: '#484f58',
  };
  const label: Record<string, string> = {
    synced:  'synced',
    syncing: 'syncing…',
    error:   'error',
    offline: 'offline',
  };
  const title: Record<string, string> = {
    synced:  'Python backend connected — handling indices from DAG model',
    syncing: 'Python backend syncing…',
    error:   'Python backend returned an error — using TypeScript fallback',
    offline: 'Python backend offline — all values from TypeScript engine',
  };

  return (
    <div className="kpi-pill" title={title[status] ?? ''}>
      <div className="kpi-dot" style={{ background: dot[status] ?? '#484f58' }} />
      <span className="kpi-label">Backend</span>
      <span className="kpi-val" style={{ color: dot[status] ?? '#484f58' }}>
        {label[status] ?? 'offline'}
      </span>
    </div>
  );
}

// ── Header KPI pills ────────────────────────────────────────────────────────
function KPIPills() {
  const results = useStore(s => s.results);
  const { trail } = results.geometry;
  const trailOk = trail >= 80 && trail <= 120;
  const frontPct = results.cog.frontPercent;
  const as = results.antiSquat.antiSquatPercent;
  const squatR = results.antiSquat.squatRatio;
  // R near 1.0 = neutral (Cossalter). Green 0.7–1.3, warn otherwise.
  const asOk = squatR > 0 ? (squatR >= 0.7 && squatR <= 1.3) : (as >= 60 && as <= 120);

  return (
    <div className="header-kpis">
      <div className="kpi-pill">
        <div className="kpi-dot" style={{ background: trailOk ? 'var(--accent2)' : 'var(--warn)' }} />
        <span className="kpi-label">Trail</span>
        <span className="kpi-val">{trail.toFixed(0)}mm</span>
      </div>
      <div className="kpi-pill">
        <div className="kpi-dot" style={{ background: Math.abs(frontPct - 50) < 8 ? 'var(--accent2)' : 'var(--warn)' }} />
        <span className="kpi-label">F/R</span>
        <span className="kpi-val">{frontPct.toFixed(0)}%/{results.cog.rearPercent.toFixed(0)}%</span>
      </div>
      <div className="kpi-pill">
        <div className="kpi-dot" style={{ background: asOk ? 'var(--accent2)' : 'var(--warn)' }} />
        <span className="kpi-label">AS / R</span>
        <span className="kpi-val">{isFinite(as) ? as.toFixed(0) : '—'}% · {squatR > 0 ? squatR.toFixed(2) : '—'}</span>
      </div>
      <div className="kpi-pill">
        <span className="kpi-label">CoG</span>
        <span className="kpi-val">{results.cog.Y_cg.toFixed(0)}mm</span>
      </div>
    </div>
  );
}

// ── Resizable two-pane splitter ────────────────────────────────────────────
/**
 * ResizableSplit: renders left + right children separated by a draggable handle.
 * defaultLeftPct: initial left width as a percentage [10..90].
 * minPct / maxPct: clamping bounds.
 */
function ResizableSplit({
  left, right, defaultLeftPct = 32, minPct = 12, maxPct = 72,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPct?: number;
  minPct?: number;
  maxPct?: number;
}) {
  const [leftPct, setLeftPct] = useState(defaultLeftPct);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const container = containerRef.current;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(maxPct, Math.max(minPct, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [minPct, maxPct]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Left pane */}
      <div style={{ width: `${leftPct}%`, minWidth: 0, overflow: 'auto', flexShrink: 0 }}>
        {left}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          width: 5, flexShrink: 0, cursor: 'col-resize',
          background: 'var(--border, #30363d)',
          position: 'relative', zIndex: 5,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent, #58a6ff)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--border, #30363d)')}
        title="Drag to resize"
      />

      {/* Right pane */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {right}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  // Mount backend sync — debounced auto-sync on every input change
  useBackendSync();

  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const loadFamily      = useStore(s => s.loadFamily);
  const loadCustomBike  = useStore(s => s.loadCustomBike);
  const familyName      = useStore(s => s.familyName);
  const customBikes     = useStore(s => s.customBikes);
  const updateCustomBike = useStore(s => s.updateCustomBike);
  const input           = useStore(s => s.input);
  const error           = useStore(s => s.error);
  const saveSession     = useStore(s => s.saveSession);
  const exportJSON      = useStore(s => s.exportJSON);
  const exportCSV       = useStore(s => s.exportCSV);
  const addSnapshot      = useStore(s => s.addSnapshot);
  const snapCount        = useStore(s => s.snapshots.length);
  const [saved, setSaved] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [snapLabel, setSnapLabel]     = useState('');
  const [showSnapInput, setShowSnapInput] = useState(false);
  const snapInputRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();
  const { username, logout } = useAuth();

  const activeCustomBike = customBikes.find(b => b.id === familyName) ?? null;

  function handleFamilyChange(val: string) {
    if (val === '__new_custom__') {
      setEditingCustomId(null);
      setShowCustomModal(true);
    } else if (val.startsWith('custom_')) {
      loadCustomBike(val);
    } else {
      loadFamily(val);
    }
  }

  function handleUpdateCustom() {
    if (!activeCustomBike) return;
    updateCustomBike(activeCustomBike.id, input);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // ── Electron IPC wiring ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI!;

    // File > Save Config → write JSON via native dialog
    api.onConfigSaveRequest(async () => {
      const filePath = await api.saveFile(
        [{ name: 'Chassis Config', extensions: ['json'] }],
        `chassis-${familyName.replace(/\s+/g, '-').toLowerCase()}.json`,
      );
      if (filePath) {
        const ok = await api.writeFile(filePath, JSON.stringify(input, null, 2));
        if (ok) setSaved(true), setTimeout(() => setSaved(false), 1500);
      }
    });

    // File > Open Config → load JSON
    api.onConfigLoad((data) => {
      try {
        const parsed = data as typeof input;
        useStore.setState({ input: parsed });
      } catch { /* ignore malformed files */ }
    });

    // File > Export CSV
    api.onExportCSV(() => exportCSV());

    return () => {
      api.removeAllListeners('config:save-request');
      api.removeAllListeners('config:load');
      api.removeAllListeners('export:csv');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyName]);

  async function handleSave() {
    if (isElectron) {
      // In Electron: native file dialog via IPC
      window.electronAPI!.saveConfig(input);
    } else {
      // In browser: localStorage
      saveSession();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const isOverview   = activeTab === 'Overview';
  const isGraphs     = activeTab === 'Graphs';
  const is3D         = activeTab === '3D';
  const isCompare       = activeTab === 'Compare';
  const isSimulator     = activeTab === 'Simulator';
  const isChassisSim    = activeTab === 'Chassis Sim';
  const isAntiSquat         = activeTab === 'Anti-Squat';
  const isChassisDynamics   = activeTab === 'Chassis Dynamics';
  const isSweepCompare      = activeTab === 'Sweep Compare';
  const isAntiDive          = activeTab === 'Anti-Dive';
  const isSystem            = activeTab === 'System';
  const isInertia           = activeTab === 'Inertia';
  const isAero              = activeTab === 'Aero';
  const isTargets           = activeTab === 'Targets';
  const isSensitivity       = activeTab === 'Sensitivity';
  const isOptimizer         = activeTab === 'Optimizer';
  const isMonteCarlo        = activeTab === 'Monte Carlo';
  const isDesignJournal     = activeTab === 'Design Journal';
  const isLoadEnvelope      = activeTab === 'Load Envelope';
  const isRideQuality       = activeTab === 'Ride Quality';
  const isSuspensionStudio  = activeTab === 'Suspension Design Studio';
  const isLoadCases         = activeTab === 'Load Cases';
  const isStiffnessTargets  = activeTab === 'Stiffness Targets';

  function handleSnapshot() {
    if (showSnapInput) return;
    const defaultLabel = `Snapshot ${snapCount + 1} — ${activeTab}`;
    setSnapLabel(defaultLabel);
    setShowSnapInput(true);
    setTimeout(() => { snapInputRef.current?.focus(); snapInputRef.current?.select(); }, 40);
  }

  function confirmSnapshot() {
    const label = snapLabel.trim() || `Snapshot ${snapCount + 1}`;
    addSnapshot(label, activeTab);
    setShowSnapInput(false);
    setSnapLabel('');
  }

  return (
    <div className="workbench">
      {/* ── Header ── */}
      <div className="header">
        <div className="header-brand">
          <h1>CHASSIS WORKBENCH</h1>
          <span className="sub">Motorcycle Dynamics · Foale / Cossalter</span>
        </div>

        <select className="family-select" value={familyName} onChange={e => handleFamilyChange(e.target.value)}>
          <optgroup label="Presets">
            {FAMILIES.map(f => <option key={f.name} value={f.name}>{f.name} — {f.description}</option>)}
          </optgroup>
          {customBikes.length > 0 && (
            <optgroup label="Custom Bikes">
              {customBikes.map(b => <option key={b.id} value={b.id}>{b.name}{b.description ? ` — ${b.description}` : ''}</option>)}
            </optgroup>
          )}
          <option value="__new_custom__">+ New Custom Bike…</option>
        </select>

        <KPIPills />
        <BackendBadge />

        {/* Snapshot quick-capture */}
        {showSnapInput ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 6 }}>
            <input
              ref={snapInputRef}
              value={snapLabel}
              onChange={e => setSnapLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmSnapshot(); if (e.key === 'Escape') setShowSnapInput(false); }}
              placeholder="Snapshot name…"
              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, width: 180,
                background: 'var(--surface2)', border: '1px solid var(--accent)66',
                color: 'var(--text-primary)' }}
            />
            <button onClick={confirmSnapshot}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600 }}>
              Save
            </button>
            <button onClick={() => setShowSnapInput(false)}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              ✕
            </button>
          </div>
        ) : (
          <button onClick={handleSnapshot}
            title="Save a snapshot of the current design to the Design Journal"
            style={{ fontSize: 10, padding: '2px 9px', borderRadius: 4, cursor: 'pointer',
              marginLeft: 6, background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            📸 <span style={{ fontSize: 9 }}>Snapshot</span>
          </button>
        )}

        <div style={{ display: 'flex', gap: 5, marginLeft: 'auto', alignItems: 'center' }}>
          <button className="theme-btn" onClick={toggleTheme}>{theme === 'dark' ? '☀' : '🌙'}</button>
          <button
            title={`Signed in as ${username} — click to sign out`}
            onClick={logout}
            style={{
              fontSize: 10, padding: '2px 9px', borderRadius: 4, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--muted)', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            🔒 <span style={{ fontSize: 9, letterSpacing: 0.5 }}>{username}</span>
          </button>
          {activeCustomBike ? (
            <>
              <button
                className="hdr-btn"
                style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}
                onClick={handleUpdateCustom}
                title={`Save current parameters back to custom bike "${activeCustomBike.name}"`}
              >
                {saved ? '✓ Updated' : 'Update Custom'}
              </button>
              <button
                className="hdr-btn"
                onClick={() => { setEditingCustomId(activeCustomBike.id); setShowCustomModal(true); }}
                title="Rename or re-describe this custom bike"
              >
                Edit Info
              </button>
            </>
          ) : (
            <button
              className="hdr-btn"
              onClick={() => { setEditingCustomId(null); setShowCustomModal(true); }}
              title="Save current workbench state as a new custom bike"
            >
              + Custom
            </button>
          )}
          <button className={`hdr-btn ${saved && !activeCustomBike ? 'active' : ''}`} onClick={handleSave}>
            {saved && !activeCustomBike ? '✓ Saved' : 'Save'}
          </button>
          <button className="hdr-btn" onClick={exportJSON}>↓ JSON</button>
          <button className="hdr-btn" onClick={exportCSV}>↓ CSV</button>
        </div>

        {error && <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 6 }}>⚠ {error}</span>}
      </div>

      {/* ── Full-width Top Tab Bar ── */}
      <TopTabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* ── Body ── */}
      <div className="body">

        {/* Compare: full width */}
        {isCompare && <ComparePanel />}

        {/* Simulator: full width */}
        {isSimulator && <MBDPanel />}

        {/* Chassis Sim: full width split layout (panel handles its own left/right) */}
        {isChassisSim && <ChassisSweepPanel />}

        {/* Anti-Squat Analysis: full width split layout */}
        {isAntiSquat && <AntiSquatPanel />}

        {/* Chassis Dynamics: full width split layout */}
        {isChassisDynamics && <ChassisDynamicsPanel />}

        {/* Sweep Compare: full width split layout */}
        {isSweepCompare && <SweepComparePanel />}

        {/* Anti-Dive Dashboard: full width split layout */}
        {isAntiDive && <AntiDiveDashboard />}

        {/* System: full width unified parameters + results */}
        {isSystem && <SystemPanel />}

        {/* Aero: full width — left inputs + centre KPIs + right charts */}
        {isAero && <AeroPanel />}

        {/* Targets: full width — Design Target Card + Fitness Score */}
        {isTargets && <TargetsPanel />}

        {/* Sensitivity: full width — Parameter Sensitivity Heatmap */}
        {isSensitivity && <SensitivityPanel />}

        {/* Optimizer: full width — Multi-Objective Optimizer */}
        {isOptimizer && <OptimizerPanel />}

        {/* Monte Carlo: full width — Tolerance Analysis */}
        {isMonteCarlo && <MonteCarloPanel />}

        {/* Design Journal: full width — Iteration History */}
        {isDesignJournal && <DesignJournalPanel />}

        {/* Load Envelope: full width — Structural Load Analysis */}
        {isLoadEnvelope && <LoadEnvelopePanel />}

        {/* Ride Quality: full width — ISO 2631 Ride Quality Index */}
        {isRideQuality && <RideQualityPanel />}

        {/* Suspension Design Studio: full width — isolated suspension engineering studio */}
        {isSuspensionStudio && <SuspensionDesignStudio />}
        {isLoadCases && <LoadCasesPanel />}
        {isStiffnessTargets && <StiffnessTargetsPanel />}

        {/* Normal layout: left input panel + right view panel — with resizable splitter */}
        {!isCompare && !isSimulator && !isChassisSim && !isAntiSquat && !isChassisDynamics && !isSweepCompare && !isAntiDive && !isSystem && !isAero && !isTargets && !isSensitivity && !isOptimizer && !isMonteCarlo && !isDesignJournal && !isLoadEnvelope && !isRideQuality && !isSuspensionStudio && !isLoadCases && !isStiffnessTargets && (
          isOverview || isGraphs || is3D || isInertia ? (
            /* No left panel for these tabs */
            <div className="right-panel">
              {isOverview && <OverviewPanel />}
              {isGraphs   && <GraphsPanel />}
              {is3D       && <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}><Chassis3D /></div>}
              {isInertia  && <InertiaPanel />}
            </div>
          ) : (
            <ResizableSplit
              defaultLeftPct={32}
              minPct={12} maxPct={68}
              left={
                <div className="left-panel" style={{ height: '100%' }}>
                  <div className="panel-body">
                    {INPUT_PANELS[activeTab]}
                  </div>
                </div>
              }
              right={
                <div className="right-panel" style={{ height: '100%' }}>
                  <>
                    <div className="svg-area"><ChassisViz2D /></div>
                    <div className="results-area"><ResultsPanel /></div>
                  </>
                </div>
              }
            />
          )
        )}
      </div>

      {/* ── Floating AI Chat ── */}
      <AIChatPanel />

      {/* ── Custom Bike Modal ── */}
      {showCustomModal && (
        <CustomBikeModal
          editing={editingCustomId ? customBikes.find(b => b.id === editingCustomId) : undefined}
          onClose={() => { setShowCustomModal(false); setEditingCustomId(null); }}
        />
      )}
    </div>
  );
}
