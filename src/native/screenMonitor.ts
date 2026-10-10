import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import {
  ScreenElement,
  ScreenObservation,
} from '../screen/screenModel';

export type ScreenMonitorStatus = {
  accessibilityEnabled: boolean;
  monitoring: boolean;
};

interface ScreenMonitorNativeModule {
  getStatus(): Promise<ScreenMonitorStatus>;
  openAccessibilitySettings(): Promise<void>;
  setMonitoring(enabled: boolean): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeModule: ScreenMonitorNativeModule | null =
  Platform.OS === 'android'
    ? NativeModules.ScreenMonitor ?? null
    : null;

function isScreenObservation(value: object): value is ScreenObservation {
  const observation = value as Partial<ScreenObservation>;
  return (
    typeof observation.packageName === 'string' &&
    typeof observation.capturedAt === 'number' &&
    typeof observation.screenWidth === 'number' &&
    typeof observation.screenHeight === 'number' &&
    Array.isArray(observation.accessibilityElements) &&
    observation.accessibilityElements.every(isScreenElement) &&
    Array.isArray(observation.ocrElements) &&
    observation.ocrElements.every(isScreenElement) &&
    (observation.ocrStatus === 'complete' ||
      observation.ocrStatus === 'unavailable' ||
      observation.ocrStatus === 'failed') &&
    (observation.ocrError === undefined ||
      typeof observation.ocrError === 'string')
  );
}

function isScreenElement(value: unknown): value is ScreenElement {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const element = value as Partial<ScreenElement>;
  const bounds = element.bounds;
  return (
    typeof element.text === 'string' &&
    (element.source === 'accessibility' || element.source === 'ocr') &&
    typeof bounds === 'object' &&
    bounds !== null &&
    typeof bounds.left === 'number' &&
    typeof bounds.top === 'number' &&
    typeof bounds.right === 'number' &&
    typeof bounds.bottom === 'number'
  );
}

export const screenMonitor = {
  isAvailable: nativeModule !== null,

  getStatus(): Promise<ScreenMonitorStatus> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.getStatus();
  },

  openAccessibilitySettings(): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.openAccessibilitySettings();
  },

  setMonitoring(enabled: boolean): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.setMonitoring(enabled);
  },

  subscribe(listener: (observation: ScreenObservation) => void) {
    if (!nativeModule) {
      throw new Error('Screen monitoring native module is not available.');
    }

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener('screenData', (event: object) => {
      if (isScreenObservation(event)) {
        listener(event);
      }
    });
    return () => subscription.remove();
  },
};
