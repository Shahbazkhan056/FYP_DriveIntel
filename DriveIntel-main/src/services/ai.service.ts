/**
 * DriveIntel AI Service
 *
 * Runs all three ONNX models fully on-device using onnxruntime-react-native:
 *   1. dtc_classifier_int8.onnx  — severity (4-class) + category (16-class) per DTC code
 *   2. sensor_anomaly_int8.onnx  — LSTM autoencoder reconstruction-error anomaly detection
 *   3. health_scorer_int8.onnx   — 0-100 vehicle health score
 *
 * Post-inference rules mirror session_inference.py exactly:
 *   Rule 1: Multi-code compound escalation
 *   Rule 2: Sensor noise suppression for no-fault sessions
 *   Rule 3: Predictive maintenance urgency
 *   Rule 4: Safety-critical sensor + DTC cross-correlation
 */

import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';  // react-native-fs provides file-system access on both platforms

// ── Types ──────────────────────────────────────────────────────────────────
export interface DTCInput {
  dtc_code: string;
  description: string;
  possible_causes: string;
}

export interface SensorSnapshot {
  rpm?: number;
  coolant_temp?: number;
  o2_voltage?: number;
  maf?: number;
  fuel_trim_short?: number;
  fuel_trim_long?: number;
  throttle_pos?: number;
  battery_voltage?: number;
  intake_air_temp?: number;
  vehicle_speed?: number;
}

export interface DTCResult {
  dtc_code: string;
  description: string;
  severity: number;
  severity_label: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_CRITICAL';
  severity_why: string;
  category: string;
  confidence: number;
  severity_probs: number[];
  possible_causes?: string;
  repair_steps?: string[];
}

export interface SensorResult {
  status: 'NORMAL' | 'MARGINAL' | 'ABNORMAL';
  anomaly_score: number;
  days_to_alert: number | null;
  trend: 'stable' | 'increasing' | 'decreasing';
}

export interface HealthResult {
  score: number;
  status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  summary: string;
  days_to_alert: number | null;
}

export interface InferenceOutput {
  session_id: string;
  model_version: string;
  inference_timestamp: string;
  dtc_analysis: DTCResult[];
  sensor_analysis: Record<string, SensorResult>;
  health: HealthResult;
  severity_summary: {
    highest_severity: string;
    active_dtcs: number;
    safety_systems: string[];
    justification: string;
    user_action: string;
  };
  workshop_query: {
    lat: number;
    lng: number;
    radius_km: number;
    fault_categories: string[];
    severity_level: string;
    urgency: string;
    filters: { min_rating: number; open_now: boolean };
  };
}

// ── Constants ──────────────────────────────────────────────────────────────
const SEVERITY_LABELS = ['LOW', 'MEDIUM', 'HIGH', 'VERY_CRITICAL'] as const;
const FAULT_CATEGORIES = [
  'engine', 'emissions', 'fuel', 'ignition', 'transmission',
  'abs_brakes', 'suspension', 'steering', 'body', 'airbag',
  'climate', 'lighting', 'security', 'network', 'hybrid', 'unknown',
] as const;

// Channel order must match the ONNX model's input axis-1 order
export const SENSOR_CHANNELS = [
  'rpm', 'coolant_temp', 'o2_voltage', 'maf',
  'fuel_trim_short', 'fuel_trim_long', 'throttle_pos',
  'battery_voltage', 'intake_air_temp', 'vehicle_speed',
] as const;

const SEQ_LEN = 120;

// IMPORTANT: min/max/std must cover idle & parked states — not just steady driving.
// throttle_pos: 0% at idle is NORMAL (was min:5 which incorrectly flagged idle as ABNORMAL).
// vehicle_speed: 0 km/h at stop is NORMAL (std widened to cover full 0–120 range).
// maf: drops below 2 g/s at idle (was min:2.0 which flagged idle airflow as ABNORMAL).
const SENSOR_PARAMS: Record<string, { mean: number; std: number; min: number; max: number }> = {
  rpm:             { mean: 800,  std: 300,  min: 0,    max: 6500 },
  coolant_temp:    { mean: 90,   std: 3,    min: 80,   max: 100  },
  o2_voltage:      { mean: 0.45, std: 0.15, min: 0.1,  max: 0.9  },
  maf:             { mean: 4.5,  std: 2.0,  min: 0,    max: 25.0 },
  fuel_trim_short: { mean: 1.5,  std: 2.0,  min: -10,  max: 10   },
  fuel_trim_long:  { mean: 1.0,  std: 1.5,  min: -10,  max: 10   },
  throttle_pos:    { mean: 14,   std: 8,    min: 0,    max: 100  },
  battery_voltage: { mean: 13.8, std: 0.2,  min: 13.2, max: 14.8 },
  intake_air_temp: { mean: 30,   std: 5,    min: 10,   max: 50   },
  vehicle_speed:   { mean: 30,   std: 30,   min: 0,    max: 200  },
};

// Hard PID alert thresholds for cross-correlation (Rule 4)
const PID_ALERT: Record<string, { hi: number; lo: number }> = {
  coolant_temp:    { hi: 105,  lo: 55   },
  battery_voltage: { hi: 15.0, lo: 11.8 },
  fuel_trim_short: { hi: 20,   lo: -20  },
  fuel_trim_long:  { hi: 18,   lo: -18  },
};

// Code-level severity caps (never exceed this level)
const CODE_CAP: Record<string, number> = {
  P0420: 1, P0421: 1, P0422: 1, P0430: 1, P0431: 1, P0432: 1,
  P0130: 1, P0131: 1, P0132: 1, P0133: 1, P0134: 1, P0135: 1,
  P0136: 1, P0137: 1, P0138: 1, P0139: 1, P0140: 1, P0141: 1,
  P0150: 1, P0151: 1, P0156: 1, P0810: 1, P0811: 1, P0812: 1,
  P0813: 1, P0814: 1, P0815: 1, P1349: 1, P1346: 1, P1348: 1,
};

// Code-level severity floors (at least this level)
const CODE_FLOOR: Record<string, number> = {
  P000A: 2, P000B: 2, P000C: 2, P000D: 2,
  P0010: 2, P0011: 2, P0012: 2, P0013: 2, P0014: 2, P0015: 2,
  P0020: 2, P0021: 2, P0022: 2, P0023: 2, P0024: 2, P0025: 2,
};

const SAFETY_CRITICAL_SYSTEMS = new Set([
  'engine', 'abs_brakes', 'airbag', 'steering', 'transmission', 'hybrid', 'ignition',
]);

const URGENCY_MAP: Record<number, string> = {
  0: 'routine', 1: 'within_week', 2: 'within_week', 3: 'immediate',
};

const USER_ACTION_MAP: Record<string, string> = {
  LOW:          'Monitor — no immediate action required',
  MEDIUM:       'Schedule service within 2 weeks',
  HIGH:         'Book workshop urgently within 3 days',
  VERY_CRITICAL: 'STOP DRIVING — contact mechanic immediately',
};

// ── TF-IDF feature builder ─────────────────────────────────────────────────
// Code prefix buckets (mirrors dtc_classifier.py)
const CODE_PREFIXES = ['P', 'B', 'C', 'U', 'X'];
const CODE_BUCKETS: [number, number][] = [
  [0, 99], [100, 199], [200, 299], [300, 399], [400, 499],
  [500, 599], [600, 699], [700, 899], [900, 999], [1000, 1999],
  [2000, 2999], [3000, 9999],
];

function bucketIndex(num: number): number {
  for (let i = 0; i < CODE_BUCKETS.length; i++) {
    const [lo, hi] = CODE_BUCKETS[i];
    if (num >= lo && num <= hi) return i;
  }
  return CODE_BUCKETS.length - 1;
}

function buildTabularFeature(prefix: string, codeNumber: number): Float32Array {
  const vec = new Float32Array(CODE_PREFIXES.length + CODE_BUCKETS.length);
  const pi = CODE_PREFIXES.indexOf(prefix.toUpperCase());
  vec[pi >= 0 ? pi : CODE_PREFIXES.indexOf('X')] = 1;
  vec[CODE_PREFIXES.length + bucketIndex(codeNumber)] = 1;
  return vec;
}

// ── Model Parameter Cache ─────────────────────────────────────────────────
interface ModelParams {
  tfidf: {
    vocabulary: Record<string, number>;
    idf: number[];
    sublinear_tf: boolean;
    ngram_range: [number, number];
  };
  sensor_anomaly: {
    norm_mean: number[];
    norm_std: number[];
    threshold: number;
    ch_thresholds: number[];
    channels: string[];
    seq_len: number;
    n_sensors: number;
  };
  health_scorer: {
    sc_mean: number[];
    sc_std: number[];
    hidden: number;
  };
}

// ── AI Service ────────────────────────────────────────────────────────────
class AIServiceClass {
  private dtcSession: InferenceSession | null = null;
  private sensorSession: InferenceSession | null = null;
  private healthSession: InferenceSession | null = null;
  private params: ModelParams | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // On Android, assets must be copied from the apk to a readable fs path first
  private async ensureAndroidAsset(filename: string): Promise<string> {
    const destDir = `${RNFS.CachesDirectoryPath}/models`;
    const dest = `${destDir}/${filename}`;
    try {
      const exists = await RNFS.exists(dest);
      if (!exists) {
        await RNFS.mkdir(destDir);
        await RNFS.copyFileAssets(`models/${filename}`, dest);
      }
    } catch (e) {
      console.warn(`[AI] ensureAndroidAsset ${filename}:`, e);
    }
    return dest;
  }

  private async resolveModelPath(filename: string): Promise<string> {
    if (Platform.OS === 'android') {
      return this.ensureAndroidAsset(filename);
    }
    return `${RNFS.MainBundlePath}/models/${filename}`;
  }

  private async loadParams(): Promise<ModelParams> {
    if (Platform.OS === 'android') {
      const path = await this.ensureAndroidAsset('model_params.json');
      const raw = await RNFS.readFile(path, 'utf8');
      return JSON.parse(raw);
    }
    const path = `${RNFS.MainBundlePath}/models/model_params.json`;
    const raw = await RNFS.readFile(path, 'utf8');
    return JSON.parse(raw);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        console.log('[AI] Initializing ONNX models…');

        // Load model parameters JSON
        this.params = await this.loadParams();

        // Resolve paths (copies from assets on Android)
        const [dtcPath, sensorPath, healthPath] = await Promise.all([
          this.resolveModelPath('dtc_classifier_int8.onnx'),
          this.resolveModelPath('sensor_anomaly_int8.onnx'),
          this.resolveModelPath('health_scorer_int8.onnx'),
        ]);

        // Also ensure .data files are in the same directory (external ONNX data)
        if (Platform.OS === 'android') {
          await Promise.all([
            this.ensureAndroidAsset('dtc_classifier.onnx.data'),
            this.ensureAndroidAsset('health_scorer.onnx.data'),
          ]);
        }

        // Create inference sessions
        const opts = { executionProviders: ['cpu'] };
        [this.dtcSession, this.sensorSession, this.healthSession] = await Promise.all([
          InferenceSession.create(dtcPath, opts),
          InferenceSession.create(sensorPath, opts),
          InferenceSession.create(healthPath, opts),
        ]);

        this.initialized = true;
        console.log('[AI] All models loaded successfully');
      } catch (err) {
        console.error('[AI] Initialization failed:', err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  // ── TF-IDF transform ────────────────────────────────────────────────────
  // Mirrors DTCFeaturiser.transform() from dtc_classifier.py
  private tfidfTransform(texts: string[]): Float32Array[] {
    const { vocabulary, idf, sublinear_tf, ngram_range } = this.params!.tfidf;
    const maxN = ngram_range[1];
    const results: Float32Array[] = [];

    for (const text of texts) {
      const tf: Record<number, number> = {};
      const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const vocab = vocabulary;

      // Count term frequencies for unigrams and bigrams
      for (let i = 0; i < tokens.length; i++) {
        const unigram = tokens[i];
        const idx = vocab[unigram];
        if (idx !== undefined) {
          tf[idx] = (tf[idx] ?? 0) + 1;
        }
        if (maxN >= 2 && i + 1 < tokens.length) {
          const bigram = `${tokens[i]} ${tokens[i + 1]}`;
          const bidx = vocab[bigram];
          if (bidx !== undefined) {
            tf[bidx] = (tf[bidx] ?? 0) + 1;
          }
        }
      }

      const vec = new Float32Array(idf.length);
      let norm = 0;
      for (const [idxStr, count] of Object.entries(tf)) {
        const idx = Number(idxStr);
        const tfVal = sublinear_tf ? 1 + Math.log(count) : count;
        const tfidf = tfVal * idf[idx];
        vec[idx] = tfidf;
        norm += tfidf * tfidf;
      }

      // L2 normalize
      if (norm > 0) {
        const scale = 1 / Math.sqrt(norm);
        for (let i = 0; i < vec.length; i++) {
          if (vec[i] !== 0) vec[i] *= scale;
        }
      }
      results.push(vec);
    }
    return results;
  }

  // ── DTC Classification ──────────────────────────────────────────────────
  private async classifyDTCs(records: DTCInput[]): Promise<DTCResult[]> {
    if (!this.dtcSession || !this.params) return [];

    const texts = records.map(r => `${r.description} ${r.possible_causes}`);
    const tfidfVecs = this.tfidfTransform(texts);
    const tabSize = CODE_PREFIXES.length + CODE_BUCKETS.length; // 17
    const inputDim = tabSize + this.params.tfidf.idf.length;    // 3017

    // Build batch tensor: (N, 3017)
    const batchData = new Float32Array(records.length * inputDim);
    for (let i = 0; i < records.length; i++) {
      const code = records[i].dtc_code.trim().toUpperCase();
      const prefix = code[0]?.match(/[A-Z]/) ? code[0] : 'X';
      const nums = code.replace(/[^0-9]/g, '');
      const codeNumber = nums ? parseInt(nums, 10) : 0;

      const tab = buildTabularFeature(prefix, codeNumber);
      batchData.set(tab, i * inputDim);
      batchData.set(tfidfVecs[i], i * inputDim + tabSize);
    }

    const inputTensor = new Tensor('float32', batchData, [records.length, inputDim]);
    const output = await this.dtcSession.run({ features: inputTensor });

    const sevLogits  = output.severity_logits.data as Float32Array;
    const catLogits  = output.category_logits.data as Float32Array;

    const results: DTCResult[] = [];
    for (let i = 0; i < records.length; i++) {
      // Softmax on severity logits
      const sevSlice = sevLogits.slice(i * 4, i * 4 + 4);
      const sevProbs = softmax(Array.from(sevSlice));
      const sevIdx   = argmax(sevProbs);

      // Softmax on category logits
      const catSlice = catLogits.slice(i * 16, i * 16 + 16);
      const catProbs = softmax(Array.from(catSlice));
      const catIdx   = argmax(catProbs);

      // Apply severity caps/floors
      let sev = sevIdx;
      const code = records[i].dtc_code.toUpperCase();
      if (CODE_CAP[code] !== undefined && sev > CODE_CAP[code]) sev = CODE_CAP[code];
      if (CODE_FLOOR[code] !== undefined && sev < CODE_FLOOR[code]) sev = CODE_FLOOR[code];

      results.push({
        dtc_code:        records[i].dtc_code,
        description:     records[i].description,
        severity:        sev,
        severity_label:  SEVERITY_LABELS[sev],
        severity_why:    '',
        category:        FAULT_CATEGORIES[catIdx] ?? 'unknown',
        confidence:      parseFloat(Math.max(...sevProbs).toFixed(4)),
        severity_probs:  sevProbs.map(p => parseFloat(p.toFixed(4))),
        possible_causes: (records[i] as any).possible_causes ?? '',
        repair_steps:    (records[i] as any).repair_steps    ?? [],
      });
    }

    return results;
  }

  // ── Sensor Anomaly Detection ─────────────────────────────────────────────
  private async detectSensorAnomalies(
    snapshot: SensorSnapshot,
  ): Promise<Record<string, SensorResult>> {
    if (!this.sensorSession || !this.params) return {};

    const sa = this.params.sensor_anomaly;
    const channels = sa.channels;
    const normMean = sa.norm_mean;
    const normStd  = sa.norm_std;
    const chThresh = sa.ch_thresholds;

    // Build (1, SEQ_LEN, N_SENSORS) input — simulate a 30-reading window
    // by repeating the snapshot with small jitter (mirrors session_inference.py)
    const seqData = new Float32Array(SEQ_LEN * channels.length);
    const rng = seededRng(42);

    for (let ci = 0; ci < channels.length; ci++) {
      const ch = channels[ci];
      const rawVal = (snapshot as any)[ch] ?? SENSOR_PARAMS[ch]?.mean ?? 0;
      const jitter = Math.abs(rawVal) * 0.015 + 0.1;

      for (let t = 0; t < SEQ_LEN; t++) {
        const val = rawVal + rng() * jitter * 2 - jitter;
        // Normalize: (val - mean) / std
        seqData[t * channels.length + ci] = (val - normMean[ci]) / normStd[ci];
      }
    }

    const inputTensor = new Tensor('float32', seqData, [1, SEQ_LEN, channels.length]);
    const output = await this.sensorSession.run({ sensor_sequence: inputTensor });
    const recon = output.reconstructed_sequence.data as Float32Array;

    // Compute per-channel MSE between reconstruction and normalized input
    const results: Record<string, SensorResult> = {};
    for (let ci = 0; ci < channels.length; ci++) {
      let mse = 0;
      for (let t = 0; t < SEQ_LEN; t++) {
        const diff = recon[t * channels.length + ci] - seqData[t * channels.length + ci];
        mse += diff * diff;
      }
      mse /= SEQ_LEN;

      const thresh = chThresh[ci] + 1e-9;
      const normScore = Math.min(mse / thresh, 1.0);

      // Trend: compare second half to first half of normalized input
      let earlySum = 0, recentSum = 0;
      const half = Math.floor(SEQ_LEN / 2);
      for (let t = 0; t < half; t++) {
        earlySum  += seqData[t * channels.length + ci];
        recentSum += seqData[(t + half) * channels.length + ci];
      }
      const delta = (recentSum - earlySum) / half;
      const trend: 'stable' | 'increasing' | 'decreasing' =
        delta > 0.4 ? 'increasing' : delta < -0.4 ? 'decreasing' : 'stable';

      let status: 'NORMAL' | 'MARGINAL' | 'ABNORMAL' = 'NORMAL';
      let daysToAlert: number | null = null;
      if (normScore > 0.85) { status = 'ABNORMAL';  daysToAlert = 3;  }
      else if (normScore > 0.50) { status = 'MARGINAL'; daysToAlert = 14; }

      results[channels[ci]] = {
        status,
        anomaly_score: parseFloat(normScore.toFixed(4)),
        days_to_alert: daysToAlert,
        trend,
      };
    }

    return results;
  }

  // ── Health Scoring ───────────────────────────────────────────────────────
  private async computeHealthScore(
    dtcResults: DTCResult[],
    sensorResults: Record<string, SensorResult>,
    mileageKm: number,
  ): Promise<{ score: number; status: string }> {
    if (!this.healthSession || !this.params) return { score: 70, status: 'FAIR' };

    const hs = this.params.health_scorer;
    const feat = buildHealthFeatures(dtcResults, sensorResults, mileageKm);

    // Scale: (feat - sc_mean) / sc_std
    const scaled = new Float32Array(feat.length);
    for (let i = 0; i < feat.length; i++) {
      scaled[i] = (feat[i] - hs.sc_mean[i]) / hs.sc_std[i];
    }

    const inputTensor = new Tensor('float32', scaled, [1, feat.length]);
    const output = await this.healthSession.run({ health_features: inputTensor });
    const score = (output.health_score.data as Float32Array)[0];

    const clamped = Math.max(0, Math.min(100, score));
    const status =
      clamped < 30 ? 'CRITICAL' :
      clamped < 50 ? 'POOR' :
      clamped < 70 ? 'FAIR' :
      clamped < 88 ? 'GOOD' : 'EXCELLENT';

    return { score: parseFloat(clamped.toFixed(1)), status };
  }

  // ── Post-inference rules (mirrors session_inference.py) ──────────────────

  private applyPIDOverlay(
    sensorResults: Record<string, SensorResult>,
    snapshot: SensorSnapshot,
  ): Record<string, SensorResult> {
    for (const ch of Object.keys(sensorResults)) {
      const rawVal = (snapshot as any)[ch];
      if (rawVal === undefined) continue;
      const p = SENSOR_PARAMS[ch];
      if (!p) continue;
      const inNormal = rawVal >= p.min * 0.9 && rawVal <= p.max * 1.1 &&
        Math.abs(rawVal - p.mean) <= 2.5 * p.std;
      if (inNormal && sensorResults[ch].status !== 'NORMAL') {
        sensorResults[ch] = {
          ...sensorResults[ch],
          status: 'NORMAL',
          anomaly_score: parseFloat((sensorResults[ch].anomaly_score * 0.3).toFixed(4)),
          days_to_alert: null,
        };
      }
    }
    return sensorResults;
  }

  // Suppresses noise when the majority of sensors show anomalous WITHOUT real DTCs.
  // Typical cause: car is idle/parked so model (calibrated for driving) misfires.
  private applySensorSuppression(
    sensorResults: Record<string, SensorResult>,
    hasDTCs: boolean,
  ): Record<string, SensorResult> {
    if (hasDTCs) return sensorResults;
    const vals = Object.values(sensorResults);
    const nFlagged = vals.filter(v => v.status !== 'NORMAL').length;
    // Threshold lowered from 60% → 40%: fewer sensors need to be flagged before
    // we treat the entire reading as an idle-state false positive.
    if (nFlagged / vals.length > 0.40) {
      const sup = 0.40; // stronger suppression (was 0.55)
      for (const ch of Object.keys(sensorResults)) {
        const newScore = parseFloat((sensorResults[ch].anomaly_score * sup).toFixed(4));
        let status: 'NORMAL' | 'MARGINAL' | 'ABNORMAL' = 'NORMAL';
        let daysToAlert: number | null = null;
        if (newScore > 0.85)      { status = 'ABNORMAL';  daysToAlert = 3;  }
        else if (newScore > 0.50) { status = 'MARGINAL';  daysToAlert = 14; }
        sensorResults[ch] = { ...sensorResults[ch], status, anomaly_score: newScore, days_to_alert: daysToAlert };
      }
    }
    return sensorResults;
  }

  // Corrects sensors that are physically EXPECTED to read low at idle/parked.
  // throttle=0%, speed=0, low MAF — all perfectly normal at a red light or in park.
  private applyIdleStateNormalization(
    sensorResults: Record<string, SensorResult>,
    snapshot: SensorSnapshot,
  ): Record<string, SensorResult> {
    const speed  = snapshot.vehicle_speed ?? 0;
    const rpm    = snapshot.rpm ?? 0;
    const isIdle    = speed === 0 && rpm < 1200;
    const isParked  = speed === 0 && rpm < 200;

    if (!isIdle) return sensorResults;

    const forceNormal = (ch: string, suppressFactor = 0.15) => {
      if (sensorResults[ch] && sensorResults[ch].status !== 'NORMAL') {
        sensorResults[ch] = {
          ...sensorResults[ch],
          status: 'NORMAL',
          anomaly_score: parseFloat((sensorResults[ch].anomaly_score * suppressFactor).toFixed(4)),
          days_to_alert: null,
        };
      }
    };

    // At idle: 0% throttle and 0 km/h are ALWAYS correct
    forceNormal('throttle_pos');
    forceNormal('vehicle_speed');

    // Low MAF at idle is expected — only keep as anomalous if genuinely extreme
    if (sensorResults['maf'] && sensorResults['maf'].anomaly_score < 0.92) {
      forceNormal('maf', 0.20);
    }

    // Engine off or just started
    if (isParked) {
      forceNormal('rpm', 0.10);
      forceNormal('maf', 0.10);
    }

    return sensorResults;
  }

  private applyCrossCorrelation(
    dtcResults: DTCResult[],
    sensorResults: Record<string, SensorResult>,
    snapshot: SensorSnapshot,
  ): DTCResult[] {
    const LEAN_RICH = new Set(['P0171','P0172','P0174','P0175','P0087','P0088']);
    const COOLANT_CODES = new Set(['P0116','P0117','P0118','P0119','P0128','P0217']);

    const pidOOS = (ch: string, val: number | undefined) => {
      if (val === undefined) return false;
      const spec = PID_ALERT[ch];
      return spec ? val > spec.hi || val < spec.lo : false;
    };

    const coolantAbnormal = sensorResults['coolant_temp']?.status === 'ABNORMAL';
    const battAbnormal    = sensorResults['battery_voltage']?.status === 'ABNORMAL';
    const fuelAbnormal    = sensorResults['fuel_trim_short']?.status === 'ABNORMAL' ||
                            sensorResults['fuel_trim_long']?.status === 'ABNORMAL';

    const coolantOOS = coolantAbnormal || pidOOS('coolant_temp',    snapshot.coolant_temp);
    const battOOS    = battAbnormal    || pidOOS('battery_voltage', snapshot.battery_voltage);
    const ftOOS      = fuelAbnormal    ||
                       (pidOOS('fuel_trim_short', snapshot.fuel_trim_short) &&
                        pidOOS('fuel_trim_long',  snapshot.fuel_trim_long));
    const dtcCodes   = new Set(dtcResults.map(r => r.dtc_code.toUpperCase()));

    return dtcResults.map(r => {
      const cat  = r.category;
      const sev  = r.severity;
      const code = r.dtc_code.toUpperCase();
      let updated = { ...r };

      if (coolantOOS && ['engine','ignition','hybrid'].includes(cat) &&
          !COOLANT_CODES.has(code) && !dtcCodes.has('P0217') && sev < 2) {
        updated = { ...updated, severity: 2, severity_label: 'HIGH',
          severity_why: `coolant ${snapshot.coolant_temp}°C + ${cat} fault` };
      }
      if (battOOS && ['network','hybrid'].includes(cat) && sev < 2) {
        updated = { ...updated, severity: 2, severity_label: 'HIGH',
          severity_why: `battery ${snapshot.battery_voltage}V + ${cat} fault` };
      }
      if (ftOOS && ['fuel','emissions'].includes(cat) &&
          !LEAN_RICH.has(code) && !dtcCodes.has('P0087') && sev < 2) {
        updated = { ...updated, severity: 2, severity_label: 'HIGH',
          severity_why: `fuel trims ${snapshot.fuel_trim_short}%/${snapshot.fuel_trim_long}% + ${cat} fault` };
      }
      return updated;
    });
  }

  private applyCompoundEscalation(dtcResults: DTCResult[]): DTCResult[] {
    if (!dtcResults.length) return dtcResults;
    const highPlus = dtcResults.filter(r => r.severity >= 2);
    const safetySystems = new Set(highPlus.filter(r => SAFETY_CRITICAL_SYSTEMS.has(r.category)).map(r => r.category));
    const shouldEscalate = safetySystems.size >= 2 || highPlus.length >= 3;
    if (!shouldEscalate) return dtcResults;
    return dtcResults.map(r =>
      r.severity >= 2
        ? { ...r, severity: 3, severity_label: 'VERY_CRITICAL', severity_why: r.severity_why || 'compound escalation' }
        : r,
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async runInference(opts: {
    session_id: string;
    dtcs: DTCInput[];
    sensors: SensorSnapshot;
    mileage_km?: number;
    location?: { lat: number; lng: number };
  }): Promise<InferenceOutput> {
    await this.initialize();

    const { session_id, dtcs, sensors, mileage_km = 80_000, location = { lat: 0, lng: 0 } } = opts;

    // ── 1. DTC classification
    let dtcResults = dtcs.length ? await this.classifyDTCs(dtcs) : [];

    // ── 2. Sensor anomaly detection
    let sensorResults = await this.detectSensorAnomalies(sensors);

    // ── 3. Post-inference rules
    sensorResults = this.applyPIDOverlay(sensorResults, sensors);
    sensorResults = this.applyIdleStateNormalization(sensorResults, sensors); // idle/parked fix
    sensorResults = this.applySensorSuppression(sensorResults, dtcResults.length > 0);
    dtcResults    = this.applyCrossCorrelation(dtcResults, sensorResults, sensors);
    dtcResults    = this.applyCompoundEscalation(dtcResults);

    // ── 4. Health score
    const health = await this.computeHealthScore(dtcResults, sensorResults, mileage_km);

    // ── 5. Session summary
    const highestSevInt = dtcResults.reduce((m, r) => Math.max(m, r.severity), 0);
    const highestSev    = SEVERITY_LABELS[highestSevInt];
    const faultCats     = [...new Set(dtcResults.map(r => r.category))];

    let daysToAlert: number | null = null;
    for (const v of Object.values(sensorResults)) {
      if (v.days_to_alert !== null) {
        daysToAlert = daysToAlert === null ? v.days_to_alert : Math.min(daysToAlert, v.days_to_alert);
      }
    }

    let urgency = URGENCY_MAP[highestSevInt] ?? 'routine';
    for (const v of Object.values(sensorResults)) {
      if (v.trend === 'increasing' && v.days_to_alert !== null &&
          v.days_to_alert <= 7 && urgency === 'routine') {
        urgency = 'within_week';
        break;
      }
    }

    return {
      session_id,
      model_version: 'local-onnx-v1',
      inference_timestamp: new Date().toISOString(),
      dtc_analysis: dtcResults,
      sensor_analysis: sensorResults,
      health: {
        score:         health.score,
        status:        health.status as any,
        days_to_alert: daysToAlert,
        summary: `Vehicle health is ${health.status.toLowerCase()} (${health.score.toFixed(0)}/100).` +
          (daysToAlert ? ` Predictive alert in ${daysToAlert} day(s).` : ''),
      },
      severity_summary: {
        highest_severity: highestSev,
        active_dtcs:      dtcResults.length,
        safety_systems:   faultCats.sort(),
        justification: `${dtcResults.length} active fault(s) across ${faultCats.length} system(s). ` +
          `Highest individual severity: ${highestSev}.`,
        user_action: USER_ACTION_MAP[highestSev],
      },
      workshop_query: {
        lat:              location.lat,
        lng:              location.lng,
        radius_km:        15,
        fault_categories: faultCats,
        severity_level:   highestSev,
        urgency,
        filters: { min_rating: 3.5, open_now: true },
      },
    };
  }

  // Convenience: map OBD live data snapshot → SensorSnapshot
  mapOBDToSensors(obd: {
    rpm?: number; engine_temp?: number; maf?: number;
    throttle?: number; voltage?: number; intake_temp?: number; speed?: number;
    fuel_trim_short?: number; fuel_trim_long?: number;
  }): SensorSnapshot {
    return {
      rpm:             obd.rpm,
      coolant_temp:    obd.engine_temp,
      o2_voltage:      undefined,         // not read by OBD polling — will use default
      maf:             obd.maf,
      fuel_trim_short: obd.fuel_trim_short,
      fuel_trim_long:  obd.fuel_trim_long,
      throttle_pos:    obd.throttle,
      battery_voltage: obd.voltage,
      intake_air_temp: obd.intake_temp,
      vehicle_speed:   obd.speed,
    };
  }

  get isReady() { return this.initialized; }
}

// ── Health feature builder ─────────────────────────────────────────────────
// Mirrors build_health_features() from health_scorer.py exactly (22 features).
// Key: bat_norm/cool_norm/etc are the per-channel ANOMALY SCORES from sensorResults,
// not raw PID values — matches Python's `_sr(ch)` getter.
function buildHealthFeatures(
  dtcResults: DTCResult[],
  sensorResults: Record<string, SensorResult>,
  mileageKm: number,
): Float32Array {
  const severities = dtcResults.map(r => r.severity);
  const categories = dtcResults.map(r => r.category);
  const nDTCs      = Math.min(dtcResults.length, 20);
  const nVC        = severities.filter(s => s === 3).length;
  const nHi        = severities.filter(s => s === 2).length;
  const nMed       = severities.filter(s => s === 1).length;
  const highestSev = severities.length ? Math.max(...severities) : 0;
  const nCats      = new Set(categories).size;

  const hasMisfire = (categories.some(c => c === 'ignition') ||
    dtcResults.some(r => r.description.toLowerCase().includes('misfire'))) ? 1 : 0;
  const hasCat  = categories.some(c => c === 'emissions') ? 1 : 0;
  const hasABS  = categories.some(c => c === 'abs_brakes') ? 1 : 0;
  const hasAir  = categories.some(c => c === 'airbag') ? 1 : 0;
  const hasNet  = categories.some(c => c === 'network') ? 1 : 0;

  const sVals = Object.values(sensorResults);
  const anomScores = sVals.map(v => v.anomaly_score);
  const nAbn   = sVals.filter(v => v.status === 'ABNORMAL').length;
  const nMarg  = sVals.filter(v => v.status === 'MARGINAL').length;
  const maxAnom  = anomScores.length ? Math.max(...anomScores) : 0;
  const meanAnom = anomScores.length ? anomScores.reduce((a, b) => a + b, 0) / anomScores.length : 0;

  // Use per-channel anomaly scores as sensor health proxies (matches Python's _sr())
  const sr = (ch: string) => sensorResults[ch]?.anomaly_score ?? 0;
  const batNorm  = sr('battery_voltage');
  const coolNorm = sr('coolant_temp');
  const ftNorm   = (sr('fuel_trim_short') + sr('fuel_trim_long')) / 2;
  const mafNorm  = sr('maf');
  const rpmNorm  = sr('rpm');
  const o2Norm   = sr('o2_voltage');

  const mileageBand = Math.min(Math.floor(mileageKm / 50_000), 3);

  return new Float32Array([
    highestSev, nDTCs, nVC, nHi, nMed, nAbn, nMarg,
    maxAnom, meanAnom, batNorm, coolNorm, ftNorm, mafNorm,
    rpmNorm, o2Norm, nCats, hasMisfire, hasCat, hasABS,
    hasAir, hasNet, mileageBand,
  ]);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function argmax(arr: number[]): number {
  return arr.reduce((best, v, i) => v > arr[best] ? i : best, 0);
}

// Simple seeded PRNG (LCG) — deterministic jitter for snapshot expansion
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

export const AIService = new AIServiceClass();
export default AIService;
