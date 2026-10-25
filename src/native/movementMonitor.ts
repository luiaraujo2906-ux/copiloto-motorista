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
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

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
