import React, { useEffect } from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import AIService from './src/services/ai.service';
import NotificationService from './src/services/NotificationService';

const App = () => {
  useEffect(() => {
    // Create Android notification channels and request OS permission.
    // On iOS this shows the "Allow Notifications?" system dialog once.
    // On Android 13+ this shows the POST_NOTIFICATIONS runtime permission dialog once.
    NotificationService.init().then(() =>
      NotificationService.requestPermission()
    ).catch(err =>
      console.warn('[App] Notification setup failed:', err)
    );

    // Warm-up: load ONNX sessions and model params in the background
    // so the first Diagnostics scan has no cold-start delay.
    AIService.initialize().catch(err =>
      console.warn('[App] AI warm-up failed (will retry on first scan):', err)
    );
  }, []);

  return <AppNavigator />;
};

export default App;
