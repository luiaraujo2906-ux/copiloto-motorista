import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  AppStateStatus,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {screenMonitor, ScreenMonitorStatus} from './src/native/screenMonitor';
import {
  connectMonitorStream,
  MonitorStreamState,
} from './src/native/monitorStream';
import {
  NormalizedScreen,
  ScreenElement,
  ScreenObservation,
  normalizeScreen,
} from './src/screen/screenModel';
import {identifyScreen, ScreenDetection} from './src/screen/screenRegistry';

type IdentifiedScreen = NormalizedScreen & {
  screenDetection: ScreenDetection | null;
};

const sourceLabels = {
  accessibility: 'Acessibilidade',
  ocr: 'ML Kit OCR',
} as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function App() {
  const [status, setStatus] = useState<ScreenMonitorStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [screen, setScreen] = useState<IdentifiedScreen | null>(null);
  const latestScreenRef = useRef<IdentifiedScreen | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamState, setStreamState] = useState<{
    state: MonitorStreamState;
    message?: string;
  }>({state: 'disabled'});

  const refreshStatus = useCallback(async () => {
    try {
      const nextStatus = await screenMonitor.getStatus();
      setStatus(nextStatus);
      setStatusError(null);
    } catch (error) {
      setStatusError(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!screenMonitor.isAvailable) {
      return;
    }

    let stream: ReturnType<typeof connectMonitorStream> | null = null;
    stream = connectMonitorStream((state, message) => {
      setStreamState({state, message});
      if (state === 'connected' && latestScreenRef.current) {
        stream?.publish(latestScreenRef.current);
      }
    });
    const unsubscribe = screenMonitor.subscribe((observation: ScreenObservation) => {
      const normalized = normalizeScreen(observation);
      const identified: IdentifiedScreen = {
        ...normalized,
        screenDetection: identifyScreen(normalized),
      };
      latestScreenRef.current = identified;
      setScreen(identified);
      stream?.publish(identified);
    });
    refreshStatus();

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          refreshStatus();
        }
      },
    );

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      stream.close();
    };
  }, [refreshStatus]);

  const openAccessibilitySettings = async () => {
    setBusy(true);
    try {
      await screenMonitor.openAccessibilitySettings();
      setStatusError(null);
    } catch (error) {
      setStatusError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleMonitoring = async () => {
    if (!status) {
      return;
    }
    setBusy(true);
    try {
      await screenMonitor.setMonitoring(!status.monitoring);
      await refreshStatus();
    } catch (error) {
      setStatusError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const accessibilityEnabled = status?.accessibilityEnabled ?? false;
  const monitoring = status?.monitoring ?? false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>COPILOTO · CAPTURA LOCAL</Text>
          <Text style={styles.title}>Painel de tela</Text>
          <Text style={styles.subtitle}>
            Acompanhe informações visíveis dos aplicativos em primeiro plano.
          </Text>
        </View>

        {!screenMonitor.isAvailable || Platform.OS !== 'android' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Android necessário</Text>
            <Text style={styles.body}>
              A captura de tela depende do serviço de acessibilidade do Android.
              Esta função ainda não está disponível no iOS.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    monitoring && accessibilityEnabled
                      ? styles.statusDotActive
                      : styles.statusDotInactive,
                  ]}
                />
                <Text style={styles.cardTitle}>
                  {monitoring && accessibilityEnabled
                    ? 'Monitoramento ativo'
                    : 'Monitoramento pausado'}
                </Text>
              </View>
              <Text style={styles.body}>
                {accessibilityEnabled
                  ? 'A permissão de acessibilidade está habilitada neste dispositivo.'
                  : 'Habilite o serviço do Copiloto nas configurações de acessibilidade do Android.'}
              </Text>
              {!accessibilityEnabled ? (
                <ActionButton
                  label="Abrir configurações de acessibilidade"
                  disabled={busy}
                  onPress={openAccessibilitySettings}
                />
              ) : (
                <ActionButton
                  label={monitoring ? 'Pausar captura' : 'Iniciar captura'}
                  disabled={busy || status === null}
                  onPress={toggleMonitoring}
                  secondary={monitoring}
                />
              )}
              <Text style={styles.privacyNote}>
                A captura só começa após sua ativação. O OCR é processado no
                dispositivo; com o painel WebSocket conectado, o texto
                reconhecido é transmitido ao servidor configurado. O app não
                persiste capturas.
              </Text>
              {status?.targetPackages.length ? (
                <Text style={styles.mutedText}>
                  Pacotes monitorados: {status.targetPackages.join(', ')}
                </Text>
              ) : null}
            </View>

            {statusError ? (
              <View style={[styles.card, styles.errorCard]}>
                <Text style={styles.errorText}>{statusError}</Text>
              </View>
            ) : null}

            <View style={styles.streamStatus}>
              <View
                style={[
                  styles.statusDot,
                  streamState.state === 'connected'
                    ? styles.statusDotActive
                    : styles.statusDotInactive,
                ]}
              />
              <View style={styles.streamStatusCopy}>
                <Text style={styles.streamStatusTitle}>
                  Painel WebSocket: {getStreamStateLabel(streamState.state)}
                </Text>
                <Text style={styles.mutedText}>
                  {streamState.message ??
                    (streamState.state === 'disabled'
                      ? 'Configure a URL em src/config/monitorServer.ts.'
                      : 'As telas capturadas também serão enviadas ao painel web.')}
                </Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tela mais recente</Text>
              {screen ? (
                <Text style={styles.mutedText}>
                  {new Date(screen.capturedAt).toLocaleTimeString()}
                </Text>
              ) : null}
            </View>

            {!screen ? (
              <View style={styles.card}>
                <Text style={styles.body}>
                  Ative o monitoramento e abra um aplicativo para ver os dados
                  reconhecidos aqui.
                </Text>
              </View>
            ) : (
              <ScreenCard screen={screen} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getStreamStateLabel(state: MonitorStreamState) {
  switch (state) {
    case 'connected':
      return 'conectado';
    case 'connecting':
      return 'conectando';
    case 'disconnected':
      return 'desconectado; tentando reconectar';
    case 'error':
      return 'erro de conexão';
    case 'disabled':
      return 'não configurado';
  }
}

function ActionButton({
  label,
  disabled,
  onPress,
  secondary = false,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ScreenCard({screen}: {screen: IdentifiedScreen}) {
  const elements = screen.elements.slice(0, 50);

  return (
    <View style={styles.card}>
      <Text style={styles.packageName}>{screen.packageName}</Text>
      <Text style={styles.mutedText}>
        {screen.screenWidth} × {screen.screenHeight} px ·{' '}
        {screen.elements.length} elementos
      </Text>
      <Text style={styles.screenDetection}>
        {screen.screenDetection
          ? `Tela identificada: ${screen.screenDetection.name} · provider ${screen.screenDetection.providerId}`
          : 'Nenhuma tela conhecida identificada.'}
      </Text>
      {screen.screenDetection
        ? Object.entries(screen.screenDetection.extractedData).map(
            ([field, values]) => (
              <Text key={field} style={styles.extractedValue}>
                {field === 'rideValue' ? 'Valor da corrida' : field}:{' '}
                {values.join(', ')}
              </Text>
            ),
          )
        : null}

      {screen.ocrStatus === 'failed' ? (
        <Text style={styles.errorText}>
          OCR indisponível: {screen.ocrError ?? 'falha não especificada'}
        </Text>
      ) : screen.ocrStatus === 'unavailable' ? (
        <Text style={styles.mutedText}>
          OCR requer Android 11 ou superior. Dados de acessibilidade continuam
          disponíveis.
        </Text>
      ) : null}

      {elements.length === 0 ? (
        <Text style={styles.body}>Nenhum texto foi encontrado nesta tela.</Text>
      ) : (
        <View style={styles.elementList}>
          {elements.map((element, index) => (
            <ElementRow element={element} key={`${element.source}-${index}`} />
          ))}
        </View>
      )}
      {screen.elements.length > elements.length ? (
        <Text style={styles.mutedText}>
          Exibindo {elements.length} de {screen.elements.length} elementos.
        </Text>
      ) : null}
    </View>
  );
}

function ElementRow({element}: {element: ScreenElement}) {
  return (
    <View style={styles.elementRow}>
      <View style={styles.elementHeader}>
        <Text
          style={[
            styles.sourceBadge,
            element.source === 'ocr' ? styles.ocrBadge : styles.accessibilityBadge,
          ]}>
          {sourceLabels[element.source]}
        </Text>
        {element.textConflict ? (
          <Text style={styles.conflictBadge}>Divergência</Text>
        ) : null}
      </View>
      <Text style={styles.elementText}>{element.text}</Text>
      <Text style={styles.boundsText}>
        {element.bounds.left}, {element.bounds.top} – {element.bounds.right},{' '}
        {element.bounds.bottom}
        {element.confidence === undefined
          ? ''
          : ` · ${Math.round(element.confidence * 100)}%`}
      </Text>
    </View>
  );
}

const colors = {
  background: '#F3F6F5',
  ink: '#172521',
  muted: '#66736E',
  accent: '#146B56',
  border: '#E2E9E5',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
  },
  header: {
    marginBottom: 22,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 18,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  statusDot: {
    borderRadius: 6,
    height: 10,
    width: 10,
  },
  statusDotActive: {
    backgroundColor: '#16845F',
  },
  statusDotInactive: {
    backgroundColor: '#D69A37',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    marginTop: 16,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButton: {
    backgroundColor: '#EDF3F0',
    borderColor: colors.border,
    borderWidth: 1,
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressedButton: {
    opacity: 0.82,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
  },
  privacyNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  streamStatus: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
    padding: 14,
  },
  streamStatusCopy: {
    flex: 1,
  },
  streamStatusTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '700',
  },
  mutedText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  screenDetection: {
    backgroundColor: '#E8F3EE',
    borderRadius: 8,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    padding: 10,
  },
  extractedValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  packageName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  elementList: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: 14,
  },
  elementRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  elementHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 6,
  },
  sourceBadge: {
    borderRadius: 6,
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  accessibilityBadge: {
    backgroundColor: '#E5F3ED',
    color: '#17694F',
  },
  ocrBadge: {
    backgroundColor: '#E8EEF9',
    color: '#315D9A',
  },
  conflictBadge: {
    color: '#A15B11',
    fontSize: 10,
    fontWeight: '600',
  },
  elementText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  boundsText: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  errorCard: {
    borderColor: '#F1C7C3',
  },
  errorText: {
    color: '#A63D35',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
});

export default App;
