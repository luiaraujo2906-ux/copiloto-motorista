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
  targetPackages: string[];
};

export type PaymentRecord = {
  amount: number;
  timestamp: number;
};

export type PaymentData = {
  presets: number[];
  payments: PaymentRecord[];
  pixKey: string;
  pixName: string;
  pixCity: string;
};

interface ScreenMonitorNativeModule {
  getStatus(): Promise<ScreenMonitorStatus>;
  openAccessibilitySettings(): Promise<void>;
  setMonitoring(enabled: boolean): Promise<void>;
  getFareRatePerKm(): Promise<number>;
  setFareRatePerKm(rate: number): Promise<void>;
  bringToForeground(): Promise<void>;
  generatePixQr(amount: number, includeAmount: boolean): Promise<string>;
  recordPayment(amount: number): Promise<PaymentRecord>;
  getPaymentData(): Promise<PaymentData>;
  showDatePicker(initialDate: string): Promise<string | null>;
  setPaymentPresets(values: number[]): Promise<void>;
  setPixConfig(key: string, name: string, city: string): Promise<void>;
  deletePayment(timestamp: number): Promise<void>;
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

  getFareRatePerKm(): Promise<number> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.getFareRatePerKm();
  },

  setFareRatePerKm(rate: number): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.setFareRatePerKm(rate);
  },

  bringToForeground(): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.bringToForeground();
  },

  generatePixQr(amount: number | null): Promise<string> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Pix QR generation is available only in the Android app.'),
      );
    }
    return nativeModule.generatePixQr(amount ?? 0, amount !== null);
  },

  recordPayment(amount: number): Promise<PaymentRecord> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Payment history is available only in the Android app.'),
      );
    }
    return nativeModule.recordPayment(amount);
  },

  getPaymentData(): Promise<PaymentData> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.getPaymentData();
  },

  showDatePicker(initialDate: string): Promise<string | null> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Date selection is available only in the Android app.'),
      );
    }
    return nativeModule.showDatePicker(initialDate);
  },

  setPaymentPresets(values: number[]): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.setPaymentPresets(values);
  },

  setPixConfig(key: string, name: string, city: string): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.setPixConfig(key, name, city);
  },

  deletePayment(timestamp: number): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('Screen monitoring is available only in the Android app.'),
      );
    }
    return nativeModule.deletePayment(timestamp);
  },

  subscribePayments(listener: (payment: PaymentRecord) => void) {
    if (!nativeModule) {
      throw new Error('Screen monitoring native module is not available.');
    }

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      'paymentReceived',
      (event: unknown) => {
        if (
          typeof event === 'object' &&
          event !== null &&
          'amount' in event &&
          typeof event.amount === 'number' &&
          'timestamp' in event &&
          typeof event.timestamp === 'number'
        ) {
          listener({amount: event.amount, timestamp: event.timestamp});
        }
      },
    );
    return () => subscription.remove();
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
