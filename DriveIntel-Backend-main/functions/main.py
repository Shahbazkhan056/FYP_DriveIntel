from firebase_functions import https_fn
from firebase_admin import initialize_app, firestore
import json

initialize_app()

# ── Auth ──────────────────────────────────────────────
@https_fn.on_request()
def create_user(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    data = req.get_json()
    
    user_ref = db.collection('users').document()
    user_ref.set({
        'name': data.get('name'),
        'email': data.get('email'),
        'createdAt': firestore.SERVER_TIMESTAMP
    })
    
    return https_fn.Response(
        json.dumps({'success': True, 'userId': user_ref.id}),
        content_type='application/json'
    )

# ── Vehicle ───────────────────────────────────────────
@https_fn.on_request()
def add_vehicle(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    data = req.get_json()
    
    vehicle_ref = db.collection('vehicles').document()
    vehicle_ref.set({
        'userId': data.get('userId'),
        'make': data.get('make'),
        'model': data.get('model'),
        'year': data.get('year'),
        'vin': data.get('vin', ''),
        'createdAt': firestore.SERVER_TIMESTAMP
    })
    
    return https_fn.Response(
        json.dumps({'success': True, 'vehicleId': vehicle_ref.id}),
        content_type='application/json'
    )

# ── OBD Data ──────────────────────────────────────────
@https_fn.on_request()
def save_obd_data(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    data = req.get_json()
    
    obd_ref = db.collection('obd_data').document()
    obd_ref.set({
        'vehicleId': data.get('vehicleId'),
        'speed': data.get('speed', 0),
        'rpm': data.get('rpm', 0),
        'engineTemp': data.get('engineTemp', 0),
        'fuelLevel': data.get('fuelLevel', 0),
        'throttle': data.get('throttle', 0),
        'timestamp': firestore.SERVER_TIMESTAMP
    })
    
    return https_fn.Response(
        json.dumps({'success': True}),
        content_type='application/json'
    )

# ── Diagnostics ───────────────────────────────────────
@https_fn.on_request()
def save_diagnostic(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    data = req.get_json()
    
    diag_ref = db.collection('diagnostics').document()
    diag_ref.set({
        'vehicleId': data.get('vehicleId'),
        'dtcCodes': data.get('dtcCodes', []),
        'severity': data.get('severity', 'healthy'),
        'description': data.get('description', ''),
        'timestamp': firestore.SERVER_TIMESTAMP
    })
    
    return https_fn.Response(
        json.dumps({'success': True, 'diagnosticId': diag_ref.id}),
        content_type='application/json'
    )

# ── Maintenance ───────────────────────────────────────
@https_fn.on_request()
def save_maintenance(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    data = req.get_json()
    
    maint_ref = db.collection('maintenance').document()
    maint_ref.set({
        'vehicleId': data.get('vehicleId'),
        'serviceType': data.get('serviceType'),
        'date': data.get('date'),
        'cost': data.get('cost', 0),
        'nextDue': data.get('nextDue', ''),
        'timestamp': firestore.SERVER_TIMESTAMP
    })
    
    return https_fn.Response(
        json.dumps({'success': True}),
        content_type='application/json'
    )

# ── Get Dashboard Data ────────────────────────────────
@https_fn.on_request()
def get_dashboard(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    vehicle_id = req.args.get('vehicleId')
    
    # Get latest OBD data
    obd_docs = db.collection('obd_data')\
        .where('vehicleId', '==', vehicle_id)\
        .order_by('timestamp', direction='DESCENDING')\
        .limit(1).stream()
    
    obd_data = {}
    for doc in obd_docs:
        obd_data = doc.to_dict()
    
    # If no real data, return dummy data
    if not obd_data:
        obd_data = {
            'speed': 200,
            'rpm': 4000,
            'engineTemp': 82,
            'fuelLevel': 68,
            'throttle': 80,
            'healthScore': 92
        }
    
    return https_fn.Response(
        json.dumps(obd_data, default=str),
        content_type='application/json'
    )
