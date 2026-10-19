DriveIntel: An IoT-Based Smart Vehicle Diagnostics and Monitoring System

License: MIT
Platform
AI Runtime
Backend
Database
Hardware


DriveIntel is an offline-capable, edge-intelligent vehicle telematics and predictive maintenance platform developed as a Final Year Project at the Department of Computer Science, University of Engineering & Technology (UET) Mardan.

The system connects commodity Bluetooth Low Energy (BLE) ELM327 adapters to an on-device AI inference pipeline running directly on a smartphone. By coupling a quantized multi-head DTC classifier, a 120-step LSTM sensor autoencoder, a health-scoring regressor, a 4-stage post-inference expert rule engine, and specialized hybrid vehicle telemetry (Toyota Mode 22 / Honda Mode 21), DriveIntel bridges the gap between raw automotive sensor data and actionable vehicle health intelligence without requiring an active internet connection.

Table of Contents

Key Highlights & Innovation

System Architecture

Hardware & BLE GATT Protocol

Hybrid Vehicle Drivetrain Engine

On-Device Edge AI Pipeline

Post-Inference Expert Rule Engine

Backend REST API & Database

Mobile Application Design

System Verification & Benchmark Results

Project Directory Structure

Installation & Quickstart Guide

Project Team & Institutional Affiliation

License & Citation

Key Highlights & Innovation

100% Offline On-Device Inference: Runs three quantized neural networks directly on mid-range smartphones via onnxruntime-react-native (total package size: 0.474 MB, per-session latency: < 28 ms).

Serialised BLE GATT Command Queue: Solves packet fragmentation (20-byte BLE MTU limit) and ELM327 timing quirks via a prompt-terminated (>) FIFO command queue over Service UUID FFF0.

Hybrid Drivetrain Auto-Detection: Automatically identifies hybrid platforms (Toyota Prius, Corolla Hybrid, Honda IMA) and switches to proprietary Mode 22/21 PIDs to monitor high-voltage battery State of Charge (SoC), motor speeds, and cell temperatures.

Seven-State Hybrid Mode Machine: Dynamically sanitizes sensor data during pure EV gliding (READY_EV), eliminating false anomaly alerts caused by stopped internal combustion engines.

Predictive Sensor Drift Detection: Uses an LSTM autoencoder over a sliding 120-time-step window of 10 sensor streams to detect mechanical deterioration days before a Diagnostic Trouble Code (DTC) is triggered.

Context-Aware GPS Workshop Matchmaker: Maps detected fault categories (e.g., abs_brakes, hybrid, transmission) against nearby repair facilities using the Haversine formula and specialization-weighted sorting.

System Architecture

DriveIntel follows a decoupled three-tier edge-cloud architecture:

+-----------------------------------------------------------------------------------+
|                                 HARDWARE TIER                                     |
|  Vehicle ECU (OBD-II Port) <---> ELM327 BLE Adapter <---[BLE GATT UUID FFF0]---> |
+------------------------------------------|----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                     MOBILE PRESENTATION & EDGE AI TIER (Client)                   |
|                                                                                   |
|  +-------------------------+     +---------------------------------------------+  |
|  |     OBDService.ts       |     |              HybridService.ts               |  |
|  | - Single-thread FIFO Q  |     | - 4-Step Auto-Detection Sequence            |  |
|  | - Prompt ('>') Buffer   |     | - 7-State Hybrid Mode Machine               |  |
|  | - PID / DTC Hex Parsers |     | - Transient Sensor Sanitization             |  |
|  +------------|------------+     +----------------------|----------------------+  |
|               +--------------------+--------------------+                         |
|                                    |                                              |
|                                    v                                              |
|  +-----------------------------------------------------------------------------+  |
|  |                     AIService.ts (ONNX Runtime INT8)                        |  |
|  |                                                                             |  |
|  |   [DTC Description] ---> (1) DTC Multi-Head Classifier (98.41% Acc)        |  |
|  |                          |--> Severity: LOW, MEDIUM, HIGH, VERY_CRITICAL    |  |
|  |                          +--> Category: 16-Class Taxonomy                   |  |
|  |                                                                             |  |
|  |   [120x10 Telemetry] --> (2) LSTM Autoencoder (0.9956 AUC)                  |  |
|  |                          +--> Reconstruction Error vs Channel Thresholds    |  |
|  |                                                                             |  |
|  |   [4 Post-Inference Rules] ---> (PID Overlay, Noise Cut, Cross-Corr, Alert) |  |
|  |                                                                             |  |
|  |   [Combined Features] -> (3) Health Scorer MLP (R^2 = 0.9905)               |  |
|  |                          +--> Continuous 0 - 100 Overall Health Score       |  |
|  +-----------------------------------------------------------------------------+  |
|                                    |                                              |
|                                    v                                              |
|  +-----------------------------------------------------------------------------+  |
|  |                 React Native UI / State Management                          |  |
|  | - Live Instrument Gauges     - Component Health Cards    - Diagnostic Card  |  |
|  | - GPS Workshop Discovery     - Maintenance Service Log   - Mode Indicators  |  |
|  +---------------------------------|-------------------------------------------+  |
+------------------------------------|----------------------------------------------+
                                     | (HTTPS / REST)
                                     v
+-----------------------------------------------------------------------------------+
|                        BACKEND & PERSISTENCE TIER (Server)                        |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                             FastAPI Engine                                  |  |
|  | - Token Auth (/auth)                  - Telemetry Ingestion (/obd/data)     |  |
|  | - Stored Session Mirror (/ai/diagnose) - Workshop Matchmaker (/workshops)   |  |
|  +-----------------------------------------------------------------------------+  |
|  |                    SQLite Database (SQLAlchemy ORM)                         |  |
|  |   [users]   [vehicles]   [obd_sessions]   [dtc_records]   [workshops]       |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+


Hardware & BLE GATT Protocol

1. ELM327 BLE Adapter Specifications

DriveIntel interfaces with standard ELM327 Bluetooth Low Energy dongles plugged into the vehicle's 16-pin OBD-II Data Link Connector (DLC).

Primary Service UUID: 0000FFF0-0000-1000-8000-00805F9B34FB (FFF0)

Write Characteristic UUID: 0000FFF2-0000-1000-8000-00805F9B34FB (FFF2)

Notify Characteristic UUID: 0000FFF1-0000-1000-8000-00805F9B34FB (FFF1)

2. AT Initialisation Sequence

Upon connection, OBDService.ts issues a sequence of configuration commands:

ATZ       -> Reset interpreter and verify hardware banner
ATE0      -> Disable command echo to optimize bandwidth
ATL0      -> Strip linefeed characters from responses
ATS0      -> Strip whitespace formatting for faster parsing
ATH0      -> Strip CAN ID headers from responses
ATSP0     -> Enable automatic OBD-II protocol detection (CAN priority)
ATAT1     -> Enable adaptive timing for variable ECU response latencies


3. FIFO Command Queue Architecture

ELM327 clones are strictly single-threaded; issuing a query before the previous command has completed yields interleaved, corrupt responses. Furthermore, responses exceeding the 20-byte BLE notification MTU arrive fragmented across multiple events.

Mobile App (OBDService)           Command Queue                     ELM327 Adapter (BLE)
       |                                |                                    |
       |--- enqueue(010C: RPM) -------->|                                    |
       |                                |-- write(FFF2: "010C\r") ---------->|
       |                                |<-- notify(FFF1: "41 0C ") ---------| (Chunk 1)
       |                                |<-- notify(FFF1: "1A F8>\r") -------| (Chunk 2 with '>')
       |                                |-- [Assemble & Verify '>']          |
       |<-- resolve(RPM = 1726) --------|                                    |
       |                                |                                    |
       |--- enqueue(010D: Speed) ------>|-- write(FFF2: "010D\r") ---------->|


4. Monitored Sensor Parameters

Mode / PID

Parameter Name

Range / Unit

Diagnostic Significance

01 0C

Engine RPM

0 – 16,383.75 rpm

Engine speed, idle stability, stall detection

01 0D

Vehicle Speed

0 – 255 km/h

Road speed, EV glide vs ICE engagement

01 05

Coolant Temperature

-40 – 215 °C

Thermal health, overheating, thermostat failure

01 11

Throttle Position

0 – 100 %

Driver acceleration demand, TPS sensor wear

01 2F

Fuel Tank Level

0 – 100 %

Tank capacity, fuel consumption estimation

01 04

Calculated Engine Load

0 – 100 %

Volumetric engine efficiency, power delivery

01 0F

Intake Air Temp (IAT)

-40 – 215 °C

Ambient air density, manifold thermal health

01 10

Mass Air Flow (MAF)

0 – 655.35 g/s

Air intake rate, vacuum leaks, MAF fouling

01 0A

Fuel Pressure

0 – 765 kPa

Fuel rail pressure, pump degradation

01 42

Control Module Voltage

0 – 65.535 V

Alternator output, battery charging health

01 A6

Odometer Reading

km (where supported)

Mileage accumulation, service interval tracking

Mode 03

Read Stored DTCs

Alphanumeric (P/C/B/U)

Stored ECU trouble codes

Mode 04

Clear DTCs / Reset MIL

Command

Clears diagnostic memory and Check Engine Light

09 02

VIN Retrieval

17-char string

Chassis verification and vehicle identification

Hybrid Vehicle Drivetrain Engine

Generic scan tools fail to capture the state of high-voltage hybrid systems. DriveIntel incorporates a specialized subsystem (HybridService.ts) providing native telemetry support for hybrid vehicles.

1. Four-Step Hybrid Detection Protocol

Step 1: Query Standard PIDs 0x1C (OBD standard) & 0x65 (Auxiliary I/O)
        └─ If hybrid flag reported -> Set Generic Hybrid Flag.

Step 2: Query Standard Mode 01 PID 0x5B (HV Battery Remaining Life)
        └─ If non-zero response -> Confirm Hybrid Drivetrain.

Step 3: Probe Toyota Enhanced Mode 22 PID 0x2163
        └─ If valid response -> Activate Toyota/Lexus Mode 22 Decoder.

Step 4: Probe Honda Enhanced Mode 21 PID 0x2103
        └─ If valid response -> Activate Honda IMA/e:HEV Mode 21 Decoder.


2. Seven-State Mode State Machine

Tracks real-time energy flow across the hybrid powertrain:

           +-------------[ Ignition ON / Standstill ]------------+
           |                                                      |
           v                                                      v
     [PARKED_OFF] <========================================> [READY_EV]
           ^         (Vehicle Stationary, ICE Off)                 |
           |                                                       | (Accel Demand /
           | (Decel / Brake)                                       |  Low HV SoC)
           v                                                       v
    [REGEN_BRAKING]                                        [READY_ENGINE]
           ^                                                       |
           |                                                       |
           +------------------- [TRANSITION] <---------------------+
                                (Clutch / Power Split)
                                   |          |
      (SoC < 20% While Idling)     |          | (Heavy Load / High Speed)
      +----------------------------+          +-------------------------+
      v                                                                 v
[HV_BATTERY_LOW]                                                 [CHARGING_ICE]


3. Sensor Sanitisation Rules

In hybrid vehicles, switching to READY_EV stops the internal combustion engine while cruising. Without sanitization, an LSTM trained on combustion engines would detect 0 RPM, 0 MAF, and low fuel pressure at 50 km/h as a sudden mechanical stall. HybridService.ts overrides engine-related parameters during verified EV glide, ensuring zero false-positive anomaly spikes.

On-Device Edge AI Pipeline

DriveIntel hosts three PyTorch neural networks exported to ONNX and dynamically quantized to INT8 format, executing offline through onnxruntime-react-native.

===================================================================================
1. DTC CLASSIFIER (Multi-Task MLP)
   Input:
     - 17-dim One-Hot Structural Vector (P, B, C, U, X prefix + 12 numeric buckets)
     - 500-dim TF-IDF Text Vector (Unigrams + Bigrams, Sublinear TF, L2 Norm)
   Architecture:
     Linear(517, 128) -> ReLU -> Dropout(0.2) -> Linear(128, 64) -> ReLU
     ├── Head 1: Linear(64, 4)  -> Softmax -> Severity (LOW, MED, HIGH, CRITICAL)
     └── Head 2: Linear(64, 16) -> Softmax -> Category (16 Subsystems)
   Accuracy: 98.41% | Latency: < 22 ms | Memory: 112 KB
===================================================================================
2. SENSOR ANOMALY DETECTOR (120-Step LSTM Autoencoder)
   Input:
     - Tensor [1, 120, 10]: 120-step sliding window across 10 sensor channels
       (Normalized with calibration mean/std)
   Architecture:
     - Encoder: LSTM(10, 64, num_layers=2, batch_first=True, dropout=0.2)
     - Bottleneck Latent Vector: [1, 32]
     - Decoder: RepeatVector(120) -> LSTM(32, 64, num_layers=2) -> TimeDistributed(10)
   Output:
     - Reconstructed sequence [1, 120, 10]
     - Per-channel Mean Squared Error: MSE_c = (1/120) * sum( (x_t - x^_t)^2 )
     - Anomaly Score: S_c = clip( MSE_c / ch_threshold_c, 0, 1 )
     - Status: NORMAL (S_c < 0.6), MARGINAL (0.6 <= S_c < 0.85), ABNORMAL (S_c >= 0.85)
   Validation AUC: 0.9956 | Mean Latency: 28 ms | Memory: 260 KB
===================================================================================
3. VEHICLE HEALTH SCORER (Multivariate Regressor)
   Input:
     - 22-dimensional feature vector:
       * Active DTC count by severity [4]
       * Channel anomaly scores [10]
       * Safety-critical category flags [5]
       * Normalized vehicle mileage band [3]
   Architecture:
     Linear(22, 64) -> ReLU -> Linear(64, 32) -> ReLU -> Linear(32, 1) -> Sigmoid * 100
   Output:
     - Continuous Health Score (0.0 to 100.0)
   Goodness of Fit: R^2 = 0.9905, MAE = 0.732 | Latency: < 15 ms | Memory: 102 KB
===================================================================================


Post-Inference Expert Rule Engine

Raw neural network predictions are refined by a deterministic 4-stage post-inference safety engine to prevent edge-case misclassifications and eliminate transient noise:

[Raw Model Outputs] -> [Rule 1: PID Overlay] -> [Rule 2: Noise Cut] -> [Rule 3: Cross-Corr] -> [Rule 4: Compound Escalation] -> [Final UI Diagnostic]


Rule 1: PID Physical Overlay

Condition: A sensor channel is flagged MARGINAL or ABNORMAL by the LSTM, but its raw PID reading falls within the calibrated physical limits ($\mu \pm 2.5\sigma$ and within 10% min/max).

Action: Scale anomaly score down by factor $0.3$ and reset status toward NORMAL. Eliminates false anomalies caused by harmless driving dynamics.

Rule 2: Sensor Noise Suppression

Condition: No active DTCs are present, but $>60\%$ of sensor channels exhibit simultaneous non-normal scores (typical during cold engine startup or loose dongle seating).

Action: Scale all anomaly scores by factor $0.55$, classifying the event as ambient noise rather than catastrophic multi-system failure.

Rule 3: Sensor–DTC Cross-Correlation

Condition: An out-of-range sensor reading (e.g., Coolant $> 105^\circ\text{C}$, Battery $< 12.0\text{V}$, or Short-Term Fuel Trim $> \pm 15\%$) coincides with an active DTC in a related subsystem.

Action: Escalate DTC severity to HIGH with an explicit diagnostic explanation: "Severity escalated: active sensor drift confirms ongoing mechanical fault."

Rule 4: Compound Critical Escalation

Condition: Two or more safety-critical subsystems (engine, abs_brakes, airbag, steering, transmission, hybrid, ignition) report $\ge \text{HIGH}$ severity, OR $\ge 3$ active faults exist overall.

Action: Escalate all HIGH faults to VERY_CRITICAL, issuing an immediate user alert: "Stop driving immediately. Contact professional mechanic."

Backend REST API & Database

The backend is built with FastAPI, SQLAlchemy ORM, and SQLite (driveintel.db).

1. Database Schema

+----------------+       +-------------------+       +-----------------------+
|     users      |       |     vehicles      |       |     obd_sessions      |
+----------------+       +-------------------+       +-----------------------+
| id (PK, UUID)  |<----->| id (PK, UUID)     |<----->| id (PK, UUID)         |
| name           |       | user_id (FK)      |       | vehicle_id (FK)       |
| email (Unique) |       | make, model, year |       | speed, rpm, temp,     |
| password_hash  |       | vin               |       | load, voltage, maf    |
| created_at     |       +---------|---------+       | timestamp             |
+----------------+                 |                 +-----------------------+
                                   |
         +-------------------------+-------------------------+
         |                         |                         |
         v                         v                         v
+-----------------------+ +-----------------------+ +-------------------------+
|      dtc_records      | |   vehicle_mileage     | |    maintenance_logs     |
+-----------------------+ +-----------------------+ +-------------------------+
| id (PK, UUID)         | | id (PK, UUID)         | | id (PK, UUID)           |
| vehicle_id (FK)       | | vehicle_id (FK)       | | vehicle_id (FK)         |
| code (e.g. P0301)     | | odometer_km           | | service_type, cost      |
| description, severity | | recorded_at           | | done_at_km, notes       |
| system, status        | +-----------------------+ +-------------------------+
| timestamp             |
+-----------------------+


2. Core REST Endpoints

Method

Endpoint

Description

POST

/auth/register

Create a new user account

POST

/auth/login

Authenticate user and issue session token

GET

/elm327/config

Fetch AT initialisation commands for client

GET

/pids/live

Retrieve list of active PIDs for vehicle polling

POST

/obd/data

Ingest live multi-sensor telemetry batch

GET

/obd/latest/{vehicle_id}

Fetch most recent sensor snapshot

GET

/dashboard/{vehicle_id}

Retrieve aggregated vehicle health, score, and active DTCs

POST

/dtc/save

Store newly detected DTCs

POST

/dtc/clear/{vehicle_id}

Mark vehicle DTCs as cleared (sync with Mode 04)

POST

/ai/diagnose

Server-side inference mirror for historical sessions

GET

/workshops/recommend/{vehicle_id}

Haversine distance-ranked workshops filtered by fault specialization

POST

/maintenance/log

Record vehicle servicing, repairs, and expenditures

Mobile Application Design

The frontend is implemented in React Native with TypeScript, featuring an instrumentation-style dark theme interface:

Dashboard Screen:

Circular analog/digital gauges: Vehicle Speed, Engine RPM, Coolant Temperature, Throttle Position.

Top status banner: Vehicle Health Score (0–100) with color-coded severity ring (Green: 80–100, Yellow: 50–79, Red: 0–49).

Component Health Card: Real-time status for Engine, Fuel System, Electrical System, and Air Intake.

Hybrid Mode Widget: Live State of Charge (SoC %), battery temperature, and active drivetrain state (READY_EV, REGEN_BRAKING, READY_ENGINE).

Diagnostics Screen:

Full DTC list with severity badges (LOW, MEDIUM, HIGH, VERY_CRITICAL).

Detailed fault breakdown cards explaining symptoms, underlying mechanical causes, and immediate action steps.

Mode 04 "Clear Fault Codes" command with safety verification prompt.

Workshop Discovery Screen:

GPS-enabled map and list view calculating Haversine distance to registered repair centers.

Automatic category filtering: if an ABS fault (C0035) is active, brake specialists are sorted above general mechanics.

Maintenance & Service Log:

Odometer-based maintenance tracker (oil changes, brake pad replacements, tire rotations).

Service cost analytics and history log.

System Verification & Benchmark Results

1. Model Validation Metrics

Model

Primary Metric

Validation Result

Float32 vs INT8 Drift

Quantized Size

Mean Inference Latency

DTC Multi-Head Classifier

Combined Accuracy

98.41%

-0.12%

112 KB

18 ms

LSTM Sensor Anomaly Detector

Reconstruction AUC

0.9956

-0.04%

260 KB

28 ms

Vehicle Health Scorer

R² (Goodness of Fit)

0.9905

-0.01%

102 KB

14 ms

Total Engine Bundle

—

—

—

0.474 MB

< 60 ms (Full Pipeline)

2. End-to-End System-Level Test Sessions (13 Real Vehicles & Scenarios)

Session ID

Vehicle Platform

Tested Condition / Injected Fault

Triggered Pipeline Component

System Outcome

Verification

TC-01

Daihatsu Mira 2016

Healthy baseline (nominal sensors)

Full AI pipeline

Score 100%, all sensors NORMAL

Pass

TC-02

Suzuki Cultus 2017

P0420 (Catalyst efficiency below threshold)

DTC Classifier + CODE_CAP

Severity capped at LOW; "Monitor"

Pass

TC-03

Suzuki Alto 2018

P0010 (Camshaft position actuator)

DTC Classifier + CODE_FLOOR

Severity floored at HIGH; Category Engine

Pass

TC-04

Suzuki Mehran 2010

C0035 (ABS sensor) + B0012 (Airbag loop)

Rule 4 (Compound Escalation)

Dual HIGH safety faults -> VERY_CRITICAL

Pass

TC-05

Toyota Prius 2016

Mode 22 probe (SoC 55%, engine stopped)

HybridService

Detected Toyota hybrid; Mode READY_EV

Pass

TC-06

Toyota Prius 2016

Mode 22 probe (HV battery SoC 15%)

HybridService State Machine

Mode HV_BATTERY_LOW; Alert displayed

Pass

TC-07

Honda City 2017

P0128 (Thermostat) + Coolant at 110°C

Rule 3 (Sensor-DTC Correlation)

Escalated to HIGH with overheating note

Pass

TC-08

Toyota Vitz 2014

Cold start jitter (7/10 channels non-normal)

Rule 2 (Noise Suppression)

Anomaly scores scaled x0.55; false alarm avoided

Pass

TC-09

Hyundai Elantra 2016

Transient battery dip (Raw 13.9V nominal)

Rule 1 (PID Physical Overlay)

Anomaly score reduced x0.3; status NORMAL

Pass

TC-10

Kia Sportage 2015

P1326 (Knock sensor, manufacturer-specific)

TF-IDF + Classifier

Categorized Ignition, severity MEDIUM

Pass

TC-11

Audi A4 2013

U0100 (Lost ECM/PCM communication)

DTC Classifier

Categorized Network, severity HIGH

Pass

TC-12

Suzuki Alto 2018

Active ABS fault

Workshop Recommendation Engine

ABS specialist ranked above closer general shop

Pass

TC-13

Suzuki Cultus 2017

Mode 04 DTC Clear command

OBDService + Backend Sync

DTC marked cleared in DB and UI

Pass

Project Directory Structure

DriveIntel/
├── android/                        # Android native configuration & BLE permissions
├── ios/                            # iOS Xcode project & Bluetooth entitlements
├── src/                            # Mobile Application Source (React Native & TypeScript)
│   ├── assets/
│   │   ├── models/                 # Bundled INT8 ONNX AI Models
│   │   │   ├── dtc_classifier_int8.onnx
│   │   │   ├── sensor_anomaly_int8.onnx
│   │   │   ├── health_scorer_int8.onnx
│   │   │   └── model_params.json   # TF-IDF vocabulary, sensor means/stds, thresholds
│   ├── components/                 # Reusable UI widgets (Gauges, HealthCard, DTCBadge)
│   ├── navigation/                 # Tab navigation & screen stack definitions
│   ├── screens/                    # Application Views
│   │   ├── DashboardScreen.tsx     # Live gauges, overall health, hybrid widget
│   │   ├── DiagnosticsScreen.tsx   # Active DTC cards, severity badges, Mode 04 clear
│   │   ├── MaintenanceScreen.tsx   # Service history, odometer tracking
│   │   ├── WorkshopScreen.tsx      # GPS-ranked workshop recommendations
│   │   └── ConnectionScreen.tsx    # BLE scanning, pairing, and adapter status
│   └── services/                   # Core Logic Layer
│       ├── OBDService.ts           # ELM327 BLE GATT command queue & PID parsers
│       ├── HybridService.ts        # 4-Step detection & 7-state hybrid mode machine
│       ├── AIService.ts            # ONNX Runtime on-device inference & 4 post-rules
│       ├── LocationService.ts      # Geolocation & Haversine distance calculator
│       └── api.ts                  # Axios HTTP client for FastAPI backend
├── backend/                        # Backend Server (FastAPI + SQLite)
│   ├── app/
│   │   ├── api/                    # Route handlers (auth, obd, ai, workshops, maintenance)
│   │   ├── core/                   # Security, JWT tokens, configuration settings
│   │   ├── models/                 # SQLAlchemy ORM database models
│   │   ├── schemas/                # Pydantic request/response validation schemas
│   │   ├── services/               # Server-side AI re-scoring & Haversine ranker
│   │   └── main.py                 # FastAPI application entrypoint
│   ├── requirements.txt            # Python dependencies
│   └── driveintel.db               # SQLite database file
├── ai_training/                    # Model Training & Quantization Pipeline
│   ├── train_dtc_classifier.py     # Multi-task PyTorch training script
│   ├── train_sensor_anomaly.py     # 120-step LSTM Autoencoder training script
│   ├── train_health_scorer.py      # Multivariate health regressor training script
│   └── export_onnx_quantize.py     # INT8 dynamic quantization & parameter exporter
├── docs/                           # Architectural diagrams, schematics, and screenshots
├── LICENSE                         # MIT License
└── README.md                       # Master Repository Documentation


Installation & Quickstart Guide

Prerequisites

Node.js: v18.x or higher

Python: 3.10 or higher

Mobile Development: Android Studio (SDK 33+) or Xcode (14+)

Hardware: ELM327 BLE GATT OBD-II Adapter (Bluetooth 4.0+)

1. Mobile Application Setup (React Native)

# Clone the repository
git clone https://github.com/Shahbazkhan056/FYP_DriveIntel.git
cd FYP_DriveIntel

# Install Node dependencies
npm install

# For iOS: Install CocoaPods
cd ios && pod install && cd ..

# Run on Android
npx react-native run-android

# Run on iOS
npx react-native run-ios


2. Backend Server Setup (FastAPI)

# Navigate to backend directory
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python requirements
pip install -r requirements.txt

# Start the FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

The interactive Swagger API documentation will be available at http://localhost:8000/docs.

License & Citation

This project is licensed under the MIT License - see the LICENSE file for details.

If you find DriveIntel useful in your research or automotive applications, please cite:

@thesis{driveintel2026,
  title     = {DriveIntel: An IoT-Based Smart Vehicle Diagnostics and Monitoring System},
  author    = {Muhammad Nouman,Muhammad Naveed and Shahbaz Khan},
  school    = {Department of Computer Science, University of Engineering and Technology (UET), Mardan},
  year      = {2026},
  type      = {Bachelor's Thesis}
}
