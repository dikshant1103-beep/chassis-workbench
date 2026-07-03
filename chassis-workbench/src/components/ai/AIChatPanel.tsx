import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { ComputeAllInput, ComputeAllResult } from '../../engine/types';

/* ─── Types ──────────────────────────────────────────── */
type Provider = 'ollama' | 'groq';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface AiSettings {
  provider: Provider;
  ollamaModel: string;
  groqKey: string;
  groqModel: string;
}

const SETTINGS_KEY = 'mcw_ai_settings';

function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings();
}

function defaultSettings(): AiSettings {
  return { provider: 'ollama', ollamaModel: 'llama3.2', groqKey: '', groqModel: 'llama-3.1-8b-instant' };
}

/* ─── Build system prompt ────────────────────────────── */
function buildSystemPrompt(input: ComputeAllInput, results: ComputeAllResult, familyName: string): string {
  const g = input.geometry;
  const s = input.suspension;
  const c = input.chain;
  const e = input.ergo;
  const d = input.dynamics;
  const R = results;

  return `You are an expert motorcycle chassis dynamics engineer embedded in the Motorcycle Chassis Dynamics Workbench (built on Foale/Cossalter physics). Your job is twofold:

1. EXPLAIN — describe what's happening on screen in plain, everyday language. No jargon unless the user asks. Use analogies where helpful.
2. TUNE — when the user asks to change something ("make it sportier", "reduce the trail", "stiffen the rear"), figure out the right parameters and output a <PARAMS> block.

━━━ CURRENT BIKE STATE ━━━
Preset family: ${familyName}

GEOMETRY INPUTS
  Head angle (rake): ${g.headAngle}° [sport ≈24°, cruiser ≈30°]
  Fork offset: ${g.forkOffset} mm
  Fork length: ${g.forkLength} mm
  Front wheel dia: ${g.frontWheelDia} mm (radius ${g.frontWheelDia / 2} mm)
  Rear wheel dia: ${g.rearWheelDia} mm
  Wheelbase: ${g.wheelbase} mm
  Swingarm length: ${g.swingarmLength} mm
  Swingarm pivot height: ${g.swingarmPivotHeight} mm
  Swingarm pivot X: ${g.swingarmPivotX} mm
  Rear axle height: ${g.rearAxleHeight} mm
  Front axle height: ${g.frontAxleHeight} mm
  Seat height: ${g.seatHeight} mm
  Ground clearance: ${g.groundClearance} mm

SUSPENSION INPUTS
  Spring rate front: ${s.springRateFront} N/mm | rear: ${s.springRateRear} N/mm
  Motion ratio front: ${s.motionRatioFront} | rear: ${s.motionRatioRear}
  Unsprung mass front: ${s.unsprungFront} kg | rear: ${s.unsprungRear} kg
  Sag front: ${s.sagFront} mm | rear: ${s.sagRear} mm
  Preload front: ${s.preloadFront} mm | rear: ${s.preloadRear} mm
  Compression damping: ${s.compDamping} clicks | Rebound: ${s.rebDamping} clicks
  Fork travel: ${s.forkTravel} mm | Shock travel: ${s.shockTravel} mm

CHAIN / SPROCKETS
  Front sprocket: ${c.frontSprocket}T | Rear: ${c.rearSprocket}T
  Chain force angle: ${c.chainForceAngle}°

ERGONOMICS
  Handlebar: X=${e.handlebarX} mm, Y=${e.handlebarY} mm
  Seat: X=${e.seatX} mm, Y=${e.seatY} mm
  Footpeg: X=${e.footpegX} mm, Y=${e.footpegY} mm

DYNAMICS
  Braking decel: ${d.brakingDecel} g | Accel: ${d.accelG} g
  Corner speed: ${d.cornerSpeed} m/s | Corner radius: ${d.cornerRadius} m

━━━ COMPUTED RESULTS ━━━
Geometry:
  Trail: ${R.geometry.trail.toFixed(1)} mm [OK: 80–120, warn: 60–150]
  Mechanical trail: ${R.geometry.mechanicalTrail.toFixed(1)} mm
  Swingarm angle: ${(-R.geometry.swingarmAngleDeg).toFixed(2)}° (CW+, typical +4–8°)

Centre of Gravity:
  CoG X: ${R.cog.X_cg.toFixed(1)} mm from front axle
  CoG Y: ${R.cog.Y_cg.toFixed(1)} mm from ground
  Weight distribution: ${R.cog.frontPercent.toFixed(1)}% front / ${R.cog.rearPercent.toFixed(1)}% rear [ideal front: 48–55%]
  Total mass: ${R.cog.totalMass.toFixed(1)} kg

Suspension:
  Natural freq front: ${R.suspension.natFreqFront.toFixed(3)} Hz [OK: 0.9–1.4]
  Natural freq rear: ${R.suspension.natFreqRear.toFixed(3)} Hz [OK: 0.9–1.4]
  Wheel rate front: ${R.suspension.wheelRateFront.toFixed(2)} N/mm | rear: ${R.suspension.wheelRateRear.toFixed(2)} N/mm
  Sag% front: ${R.suspension.sagPercentFront.toFixed(1)}% [OK: 22–30%] | rear: ${R.suspension.sagPercentRear.toFixed(1)}%
  Sprung mass: ${R.suspension.sprungMass.toFixed(1)} kg

Anti-Squat / Anti-Dive:
  Anti-squat: ${R.antiSquat.antiSquatPercent.toFixed(1)}% [OK: 60–120%] — how much squat is resisted under acceleration
  Chain contribution: ${R.antiSquat.chainContribution.toFixed(1)}%
  Anti-dive: ${R.antiSquat.antiDivePercent.toFixed(1)}%
  Instant centre: (${R.antiSquat.IC_x.toFixed(0)}, ${R.antiSquat.IC_y.toFixed(0)}) mm

Ergonomics:
  Knee angle: ${R.ergonomics.kneeAngleDeg.toFixed(1)}° [OK: 90–150°]
  Hip angle: ${R.ergonomics.hipAngleDeg.toFixed(1)}° [OK: 30–90°]
  Forward lean: ${R.ergonomics.forwardLeanDeg.toFixed(1)}°

Dynamics:
  Front% under braking: ${R.dynamics.frontPercentBraking.toFixed(1)}%
  Front% under acceleration: ${R.dynamics.frontPercentAccel.toFixed(1)}%
  Bank angle at speed: ${R.dynamics.bankAngleDeg.toFixed(1)}°
  Load transfer braking: ${R.dynamics.deltaW_brake.toFixed(0)} N

━━━ HOW TO RESPOND ━━━
- Keep responses SHORT unless the user wants depth. Two or three sentences is often enough.
- Never say "as an AI" or start with "Certainly!" / "Great question!".
- When the user asks what something means (e.g. "what is trail?"), explain it in one plain sentence with a real-world analogy.
- When the user says to change something (e.g. "increase trail", "make it more sporty", "stiffen the front"), compute the appropriate parameter change and include this block EXACTLY at the end of your reply:

<PARAMS>{"section": {"param": value}}</PARAMS>

Valid sections and parameters:
  geometry: headAngle, forkOffset, forkLength, frontWheelDia, rearWheelDia, wheelbase, swingarmLength, swingarmPivotHeight, swingarmPivotX, rearAxleHeight, frontAxleHeight, seatHeight, groundClearance
  suspension: springRateFront, springRateRear, motionRatioFront, motionRatioRear, unsprungFront, unsprungRear, sagFront, sagRear, preloadFront, preloadRear, compDamping, rebDamping, forkTravel, shockTravel
  chain: frontSprocket, rearSprocket, chainForceAngle
  ergo: handlebarX, handlebarY, seatX, seatY, footpegX, footpegY
  dynamics: brakingDecel, accelG, cornerSpeed, cornerRadius, trackWidth

Example: to make the steering sharper, reduce trail by lowering headAngle:
<PARAMS>{"geometry": {"headAngle": 23}}</PARAMS>

NEVER make up values — only change parameters that logically affect the user's request.`;
}

/* ─── AI request helpers ─────────────────────────────── */
async function callOllamaWithSystem(messages: Message[], model: string): Promise<string> {
  // Ollama supports system role in messages array
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 0 || txt.includes('Failed to fetch')) {
      throw new Error('Cannot reach Ollama. Is it running? Try: ollama serve');
    }
    throw new Error(`Ollama ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.message?.content ?? '';
}

async function callGroq(messages: Message[], model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/* ─── Parse <PARAMS> block from AI response ─────────── */
function parseParamsBlock(text: string): Record<string, any> | null {
  const m = text.match(/<PARAMS>([\s\S]*?)<\/PARAMS>/);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

function stripParamsBlock(text: string): string {
  return text.replace(/<PARAMS>[\s\S]*?<\/PARAMS>/g, '').trim();
}

/* ─── Settings modal ─────────────────────────────────── */
function SettingsModal({
  settings, onSave, onClose,
}: {
  settings: AiSettings;
  onSave: (s: AiSettings) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<AiSettings>({ ...settings });

  return (
    <div className="ai-settings-overlay" onClick={onClose}>
      <div className="ai-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="ai-settings-title">AI Provider Settings</div>

        <div className="ai-settings-row">
          <label>Provider</label>
          <select className="family-select" value={s.provider}
            onChange={e => setS({ ...s, provider: e.target.value as Provider })}>
            <option value="ollama">Ollama (local, free — recommended)</option>
            <option value="groq">Groq (free cloud API)</option>
          </select>
        </div>

        {s.provider === 'ollama' && (
          <>
            <div className="ai-settings-info">
              Run locally — no API key needed.<br />
              Install: <code>curl -fsSL https://ollama.com/install.sh | sh</code><br />
              Then pull a model: <code>ollama pull llama3.2</code>
            </div>
            <div className="ai-settings-row">
              <label>Model</label>
              <input className="ai-settings-input" value={s.ollamaModel}
                onChange={e => setS({ ...s, ollamaModel: e.target.value })}
                placeholder="llama3.2" />
            </div>
          </>
        )}

        {s.provider === 'groq' && (
          <>
            <div className="ai-settings-info">
              Free API — sign up at <strong>console.groq.com</strong> to get your key.
            </div>
            <div className="ai-settings-row">
              <label>API Key</label>
              <input className="ai-settings-input" type="password" value={s.groqKey}
                onChange={e => setS({ ...s, groqKey: e.target.value })}
                placeholder="gsk_..." />
            </div>
            <div className="ai-settings-row">
              <label>Model</label>
              <input className="ai-settings-input" value={s.groqModel}
                onChange={e => setS({ ...s, groqModel: e.target.value })}
                placeholder="llama-3.1-8b-instant" />
            </div>
          </>
        )}

        <div className="ai-settings-actions">
          <button className="hdr-btn" onClick={onClose}>Cancel</button>
          <button className="hdr-btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onClick={() => { onSave(s); onClose(); }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main chat panel ────────────────────────────────── */
export default function AIChatPanel() {
  const input    = useStore(s => s.input);
  const results  = useStore(s => s.results);
  const familyName = useStore(s => s.familyName);
  const setGeometry   = useStore(s => s.setGeometry);
  const setSuspension = useStore(s => s.setSuspension);
  const setChain      = useStore(s => s.setChain);
  const setErgo       = useStore(s => s.setErgo);
  const setDynamics   = useStore(s => s.setDynamics);

  const [open, setOpen]           = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings]   = useState<AiSettings>(loadSettings);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function saveSettings(s: AiSettings) {
    setSettings(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function applyParams(params: Record<string, any>) {
    if (params.geometry)   setGeometry(params.geometry);
    if (params.suspension) setSuspension(params.suspension);
    if (params.chain)      setChain(params.chain);
    if (params.ergo)       setErgo(params.ergo);
    if (params.dynamics)   setDynamics(params.dynamics);
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || loading) return;

    const systemPrompt = buildSystemPrompt(input, results, familyName);
    const systemMsg: Message = { role: 'system', content: systemPrompt };

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInputText('');
    setLoading(true);
    setError(null);

    const apiMessages: Message[] = [systemMsg, ...newMessages];

    try {
      let reply = '';
      if (settings.provider === 'ollama') {
        reply = await callOllamaWithSystem(apiMessages, settings.ollamaModel || 'llama3.2');
      } else {
        if (!settings.groqKey) throw new Error('No Groq API key set. Click the gear icon to add one.');
        reply = await callGroq(apiMessages, settings.groqModel || 'llama-3.1-8b-instant', settings.groqKey);
      }

      // Parse and apply any parameter changes
      const params = parseParamsBlock(reply);
      if (params) applyParams(params);

      const displayReply = stripParamsBlock(reply);
      const assistantMsg: Message = { role: 'assistant', content: displayReply };
      setMessages(prev => [...prev, assistantMsg]);

      // If params were applied, append a note
      if (params) {
        const sections = Object.keys(params).join(', ');
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✓ Applied changes to: ${sections}. The diagram and results updated live.`,
        }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const providerLabel = settings.provider === 'ollama'
    ? `Ollama · ${settings.ollamaModel || 'llama3.2'}`
    : `Groq · ${settings.groqModel || 'llama-3.1-8b-instant'}`;

  return (
    <>
      {/* ── Floating trigger button ─────────────────── */}
      <button
        className={`ai-fab ${open ? 'ai-fab-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Open AI Assistant"
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* ── Chat drawer ────────────────────────────── */}
      {open && (
        <div className="ai-drawer">
          {/* Header */}
          <div className="ai-drawer-header">
            <div>
              <div className="ai-title">Chassis AI</div>
              <div className="ai-provider-badge">{providerLabel}</div>
            </div>
            <button className="ai-icon-btn" title="Settings" onClick={() => setShowSettings(true)}>⚙</button>
          </div>

          {/* Messages */}
          <div className="ai-messages">
            {messages.length === 0 && (
              <div className="ai-welcome">
                <div className="ai-welcome-title">Ask me anything about your bike</div>
                <div className="ai-chip" onClick={() => setInputText('What is trail and is mine good?')}>What is trail and is mine good?</div>
                <div className="ai-chip" onClick={() => setInputText('Why is anti-squat important?')}>Why is anti-squat important?</div>
                <div className="ai-chip" onClick={() => setInputText('Make this bike more sporty')}>Make this bike more sporty</div>
                <div className="ai-chip" onClick={() => setInputText('My front suspension feels too stiff')}>My front feels too stiff</div>
                <div className="ai-chip" onClick={() => setInputText('Explain what is happening on this page')}>Explain what is on this page</div>
              </div>
            )}

            {messages.map((m, i) => (
              m.role !== 'system' && (
                <div key={i} className={`ai-msg ai-msg-${m.role}`}>
                  <div className="ai-msg-bubble">{m.content}</div>
                </div>
              )
            ))}

            {loading && (
              <div className="ai-msg ai-msg-assistant">
                <div className="ai-msg-bubble ai-thinking">
                  <span className="ai-dot" /><span className="ai-dot" /><span className="ai-dot" />
                </div>
              </div>
            )}

            {error && (
              <div className="ai-error">
                ⚠ {error}
                {settings.provider === 'ollama' && error.includes('reach Ollama') && (
                  <div style={{ marginTop: 4, fontSize: 10 }}>
                    Run <code>ollama serve</code> in a terminal, or install Ollama first.
                  </div>
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="ai-input-row">
            <textarea
              className="ai-input"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or say what to change… (Enter to send)"
              rows={2}
              disabled={loading}
            />
            <button className="ai-send-btn" onClick={sendMessage} disabled={loading || !inputText.trim()}>
              {loading ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}

      {/* ── Settings modal ──────────────────────────── */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
