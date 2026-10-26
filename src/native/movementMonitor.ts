import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  type Permission,
} from 'react-native';

export type MovementState = 'unknown' | 'moving' | 'stopped';
export type MovementSource = 'none' | 'motion_sensor' | 'gps';

export type MovementStatus = {
  state: MovementState;
  source: MovementSource;
};

interface MovementMonitorNativeModule {
  start(): Promise<void>;
  stop(): Promise<void>;
  odometerStart(): Promise<void>;
  odometerStop(): Promise<void>;
  odometerClear(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export type OdometerStatus = {
  distanceMeters: number;
  running: boolean;
  hasFix: boolean;
};

const nativeModule: MovementMonitorNativeModule | null =
  Platform.OS === 'android' ? NativeModules.MovementMonitor ?? null : null;

export const movementMonitor = {
  isAvailable: nativeModule !== null,

  async start(): Promise<void> {
    if (!nativeModule) {
      throw new Error('A detecção de movimento está disponível apenas no Android.');
    }

    const permissions: Permission[] = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ];
    if (Number(Platform.Version) >= 29) {
      permissions.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    }
    const results = await PermissionsAndroid.requestMultiple(permissions);
    if (
      results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !==
      PermissionsAndroid.RESULTS.GRANTED
    ) {
      throw new Error('A permissão de localização é necessária para o fallback por GPS.');
    }

    await nativeModule.start();
  },

  stop(): Promise<void> {
    if (!nativeModule) {
      return Promise.reject(
        new Error('A detecção de movimento está disponível apenas no Android.'),
      );
    }
    return nativeModule.stop();
  },

  subscribe(listener: (status: MovementStatus) => void) {
    if (!nativeModule) {
      return () => undefined;
    }

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      'movementChanged',
      (value: Partial<MovementStatus>) => {
        if (
          (value.state === 'unknown' ||
            value.state === 'moving' ||
            value.state === 'stopped') &&
          (value.source === 'none' ||
            value.source === 'motion_sensor' ||
            value.source === 'gps')
        ) {
          listener({state: value.state, source: value.source});
        }
      },
    );
    return () => subscription.remove();
  },
};

export const odometer = {
  async start(): Promise<void> {
    if (!nativeModule) {
      throw new Error('O odômetro está disponível apenas no Android.');
    }
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const result = await PermissionsAndroid.request(permission);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('A permissão de localização precisa é necessária para o odômetro.');
    }
    await nativeModule.odometerStart();
  },

  async stop(): Promise<void> {
    if (!nativeModule) {
      throw new Error('O odômetro está disponível apenas no Android.');
    }
    await nativeModule.odometerStop();
  },

  async clear(): Promise<void> {
    if (!nativeModule) {
      throw new Error('O odômetro está disponível apenas no Android.');
    }
    await nativeModule.odometerClear();
  },

  subscribe(listener: (status: OdometerStatus) => void) {
    if (!nativeModule) {
      return () => undefined;
    }

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      'odometerChanged',
      (value: Partial<OdometerStatus>) => {
        if (
          typeof value.distanceMeters === 'number' &&
          Number.isFinite(value.distanceMeters) &&
          value.distanceMeters >= 0 &&
          typeof value.running === 'boolean' &&
          typeof value.hasFix === 'boolean'
        ) {
          listener({
            distanceMeters: value.distanceMeters,
            running: value.running,
            hasFix: value.hasFix,
          });
        }
      },
    );
    return () => subscription.remove();
  },
};
