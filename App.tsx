import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  PaymentRecord,
  screenMonitor,
  ScreenMonitorStatus,
} from './src/native/screenMonitor';
import {
  connectMonitorStream,
  MonitorStreamState,
} from './src/native/monitorStream';
import {
  NormalizedScreen,
  ScreenObservation,
  normalizeScreen,
} from './src/screen/screenModel';
import {identifyScreen, ScreenDetection} from './src/screen/screenRegistry';
import {
  calculateFareSignal,
  DEFAULT_DRIVER_RATE_PER_KM,
} from './src/screen/fareSignal';
import {
  odometer,
  OdometerStatus,
  movementMonitor,
  MovementStatus,
} from './src/native/movementMonitor';

type IdentifiedScreen = NormalizedScreen & {
  screenDetection: ScreenDetection | null;
};

type AppTab = 'settings' | 'feedback';

const defaultPaymentPresets = [6, 10, 15];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
}

function parseAmount(value: string) {
  const trimmedValue = value.trim();
  const normalizedValue = trimmedValue.includes(',')
    ? trimmedValue.replace(/\./g, '').replace(',', '.')
    : trimmedValue;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedValue)) {
    return null;
  }
  const amount = Number(normalizedValue);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parsePaymentAmount(value: string) {
  return parseAmount(value.trim().replace(/^R\$\s*/i, ''));
}

function getLocalDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDateValue(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function mergePaymentRecords(
  first: PaymentRecord[],
  second: PaymentRecord[],
): PaymentRecord[] {
  const records = new Map<number, PaymentRecord>();
  [...first, ...second].forEach(record => records.set(record.timestamp, record));
  return [...records.values()].sort(
    (left, right) => right.timestamp - left.timestamp,
  );
}

function App() {
  const [status, setStatus] = useState<ScreenMonitorStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const latestScreenRef = useRef<IdentifiedScreen | null>(null);
  const previousScreenIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('feedback');
  const [paymentPresets, setPaymentPresets] = useState(defaultPaymentPresets);
  const [paymentPresetInput, setPaymentPresetInput] = useState('');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentPromptVisible, setPaymentPromptVisible] = useState(false);
  const [paymentSuggestedFare, setPaymentSuggestedFare] = useState('');
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentCurrentAmount, setPaymentCurrentAmount] = useState<number | null>(
    null,
  );
  const [paymentEntryVisible, setPaymentEntryVisible] = useState(false);
  const [paymentQr, setPaymentQr] = useState<string | null>(null);
  const [paymentQrError, setPaymentQrError] = useState<string | null>(null);
  const [paymentAmountError, setPaymentAmountError] = useState<string | null>(
    null,
  );
  const [paymentQrLoading, setPaymentQrLoading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentDataError, setPaymentDataError] = useState<string | null>(null);
  const [paymentStartDate, setPaymentStartDate] = useState(() =>
    getLocalDateValue(new Date()),
  );
  const [paymentEndDate, setPaymentEndDate] = useState(() =>
    getLocalDateValue(new Date()),
  );
  const [pixKeyInput, setPixKeyInput] = useState('');
  const [pixNameInput, setPixNameInput] = useState('');
  const [pixCityInput, setPixCityInput] = useState('SAO PAULO');
  const [pixConfigBusy, setPixConfigBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [movementBusy, setMovementBusy] = useState(false);
  const [movementEnabled, setMovementEnabled] = useState(false);
  const [movementStatus, setMovementStatus] = useState<MovementStatus>({
    state: 'unknown',
    source: 'none',
  });
  const [odometerStatus, setOdometerStatus] = useState<OdometerStatus>({
    distanceMeters: 0,
    running: false,
    hasFix: false,
  });
  const [odometerBusy, setOdometerBusy] = useState(false);
  const [odometerError, setOdometerError] = useState<string | null>(null);
  const [driverRateInput, setDriverRateInput] = useState(
    DEFAULT_DRIVER_RATE_PER_KM.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
  const [driverRateBusy, setDriverRateBusy] = useState(false);
  const [driverRateReady, setDriverRateReady] = useState(false);
  const [driverRateError, setDriverRateError] = useState<string | null>(null);
  const driverRatePerKmRef = useRef(DEFAULT_DRIVER_RATE_PER_KM);
  const [fareSignal, setFareSignal] = useState<
    ReturnType<typeof calculateFareSignal>
  >(null);
  const paymentPromptOpenRef = useRef(false);
  const paymentQrRequestRef = useRef(0);
  const paymentAmountInputRef =
    useRef<React.ElementRef<typeof TextInput>>(null);
  const paymentStatusOpacity = useRef(new Animated.Value(1)).current;
  const windowSize = useWindowDimensions();
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

  const refreshPaymentData = useCallback(async () => {
    if (!screenMonitor.isAvailable) {
      return;
    }
    try {
      const data = await screenMonitor.getPaymentData();
      setPaymentPresets(data.presets);
      setPayments(current => mergePaymentRecords(data.payments, current));
      setPixKeyInput(data.pixKey);
      setPixNameInput(data.pixName);
      setPixCityInput(data.pixCity);
      setPaymentDataError(null);
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
    }
  }, []);

  const loadPaymentQr = useCallback(async (amount: number | null) => {
    const requestId = paymentQrRequestRef.current + 1;
    paymentQrRequestRef.current = requestId;
    setPaymentQrLoading(true);
    setPaymentQrError(null);
    try {
      const qr = await screenMonitor.generatePixQr(amount);
      if (paymentQrRequestRef.current === requestId) {
        setPaymentQr(qr);
      }
      return paymentQrRequestRef.current === requestId;
    } catch (error) {
      if (paymentQrRequestRef.current === requestId) {
        setPaymentQr(null);
        setPaymentQrError(getErrorMessage(error));
      }
      return false;
    } finally {
      if (paymentQrRequestRef.current === requestId) {
        setPaymentQrLoading(false);
      }
    }
  }, []);

  const requestPaymentPrompt = useCallback(
    async (suggestedFare: string) => {
      if (paymentPromptOpenRef.current) {
        return;
      }
      paymentPromptOpenRef.current = true;
      try {
        await screenMonitor.bringToForeground();
        setPaymentSuggestedFare(suggestedFare);
        setPaymentAmountInput('');
        setPaymentCurrentAmount(null);
        setPaymentEntryVisible(false);
        setPaymentAmountError(null);
        setPaymentPromptVisible(true);
        await loadPaymentQr(null);
      } catch (error) {
        paymentPromptOpenRef.current = false;
        throw error;
      }
    },
    [loadPaymentQr],
  );

  const closePaymentPrompt = useCallback(() => {
    Keyboard.dismiss();
    paymentQrRequestRef.current += 1;
    paymentPromptOpenRef.current = false;
    setPaymentPromptVisible(false);
    setPaymentSuggestedFare('');
    setPaymentAmountInput('');
    setPaymentCurrentAmount(null);
    setPaymentEntryVisible(false);
    setPaymentQr(null);
    setPaymentQrError(null);
    setPaymentAmountError(null);
    setPaymentQrLoading(false);
  }, []);

  const selectPaymentAmount = useCallback(
    async (amount: number | null) => {
      if (amount === null) {
        setPaymentAmountError('Informe um valor válido.');
        return;
      }
      Keyboard.dismiss();
      const qrGenerated = await loadPaymentQr(amount);
      if (qrGenerated) {
        setPaymentCurrentAmount(amount);
        setPaymentAmountError(null);
        setPaymentEntryVisible(false);
      }
    },
    [loadPaymentQr],
  );

  const confirmPayment = async () => {
    if (paymentCurrentAmount === null) {
      setPaymentQrError('Informe o valor para confirmar o pagamento.');
      return;
    }
    setPaymentSaving(true);
    try {
      const payment = await screenMonitor.recordPayment(paymentCurrentAmount);
      setPayments(current => mergePaymentRecords([payment], current));
      setPaymentDataError(null);
      closePaymentPrompt();
    } catch (error) {
      setPaymentQrError(getErrorMessage(error));
    } finally {
      setPaymentSaving(false);
    }
  };

  useEffect(() => {
    if (!paymentPromptVisible) {
      paymentStatusOpacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(paymentStatusOpacity, {
          toValue: 0.55,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(paymentStatusOpacity, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [paymentPromptVisible, paymentStatusOpacity]);

  useEffect(() => {
    const unsubscribeMovement = movementMonitor.subscribe(setMovementStatus);
    const unsubscribeOdometer = odometer.subscribe(setOdometerStatus);
    const unsubscribePayments = screenMonitor.isAvailable
      ? screenMonitor.subscribePayments(payment => {
          setPayments(current => mergePaymentRecords([payment], current));
        })
      : () => {};
    return () => {
      unsubscribeMovement();
      unsubscribeOdometer();
      unsubscribePayments();
    };
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
      const screenId = identified.screenDetection?.id ?? null;
      if (
        screenId === 'ride-completion' &&
        previousScreenIdRef.current !== 'ride-completion'
      ) {
        const extractedFare =
          identified.screenDetection?.extractedData.rideValue?.[0] ?? '';
        const suggestedFare =
          extractedFare &&
          identified.elements.some(
            element =>
              element.source === 'ocr' &&
              element.text
                .replace(/\s+/g, '')
                .includes(extractedFare.replace(/\s+/g, '')),
          )
          ? extractedFare
          : '';
        requestPaymentPrompt(suggestedFare)
          .catch(error => setStatusError(getErrorMessage(error)));
      }
      previousScreenIdRef.current = screenId;

      const nextFareSignal =
        identified.screenDetection?.id === 'ride-offer'
          ? calculateFareSignal(
              identified.screenDetection.extractedData,
              driverRatePerKmRef.current,
            )
          : null;
      setFareSignal(nextFareSignal);
      latestScreenRef.current = identified;
      stream?.publish(identified);
    });
    refreshStatus();
    refreshPaymentData();
    screenMonitor
      .getFareRatePerKm()
      .then(rate => {
        driverRatePerKmRef.current = rate;
        setDriverRateInput(rate.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }));
        setDriverRateReady(true);
      })
      .catch(error => {
        setDriverRateError(getErrorMessage(error));
        setDriverRateReady(true);
      });

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          refreshStatus();
          refreshPaymentData();
        }
      },
    );

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      stream.close();
    };
  }, [refreshPaymentData, refreshStatus, requestPaymentPrompt]);

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

  const toggleMovementDetection = async () => {
    setMovementBusy(true);
    try {
      if (movementEnabled) {
        await movementMonitor.stop();
        setMovementEnabled(false);
      } else {
        await movementMonitor.start();
        setMovementEnabled(true);
      }
    } catch (error) {
      setStatusError(getErrorMessage(error));
    } finally {
      setMovementBusy(false);
    }
  };

  const startOdometer = async () => {
    setOdometerBusy(true);
    try {
      await odometer.start();
      setOdometerError(null);
    } catch (error) {
      setOdometerError(getErrorMessage(error));
    } finally {
      setOdometerBusy(false);
    }
  };

  const stopOdometer = async () => {
    setOdometerBusy(true);
    try {
      await odometer.stop();
      setOdometerError(null);
    } catch (error) {
      setOdometerError(getErrorMessage(error));
    } finally {
      setOdometerBusy(false);
    }
  };

  const clearOdometer = async () => {
    setOdometerBusy(true);
    try {
      await odometer.clear();
      setOdometerError(null);
    } catch (error) {
      setOdometerError(getErrorMessage(error));
    } finally {
      setOdometerBusy(false);
    }
  };

  const saveDriverRate = async () => {
    const normalizedRate = driverRateInput.trim().replace(',', '.');
    const rate = Number(normalizedRate);
    if (
      !/^\d+(?:[.,]\d{1,2})?$/.test(driverRateInput.trim()) ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      rate > 1000
    ) {
      setDriverRateError('Informe uma tarifa maior que zero e até R$ 1.000,00/km.');
      return;
    }

    setDriverRateBusy(true);
    try {
      await screenMonitor.setFareRatePerKm(rate);
      driverRatePerKmRef.current = rate;
      setDriverRateInput(
        rate.toLocaleString('pt-BR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );
      setDriverRateError(null);

      const latestScreen = latestScreenRef.current;
      const extractedData =
        latestScreen?.screenDetection?.id === 'ride-offer'
          ? latestScreen.screenDetection.extractedData
          : null;
      const nextFareSignal = extractedData
        ? calculateFareSignal(extractedData, rate)
        : null;
      setFareSignal(nextFareSignal);
    } catch (error) {
      setDriverRateError(getErrorMessage(error));
    } finally {
      setDriverRateBusy(false);
    }
  };

  const savePaymentPresets = async (nextPresets: number[]) => {
    try {
      await screenMonitor.setPaymentPresets(nextPresets);
      setPaymentPresets(nextPresets);
      setPaymentDataError(null);
      return true;
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
      return false;
    }
  };

  const addPaymentPreset = async () => {
    const amount = parseAmount(paymentPresetInput);
    if (amount === null) {
      setPaymentDataError('Informe um valor válido maior que zero.');
      return;
    }
    if (paymentPresets.some(preset => preset === amount)) {
      setPaymentDataError('Esse atalho já está cadastrado.');
      return;
    }
    if (await savePaymentPresets([...paymentPresets, amount])) {
      setPaymentPresetInput('');
    }
  };

  const addManualPayment = async () => {
    try {
      await requestPaymentPrompt('');
      setPaymentDataError(null);
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
    }
  };

  const choosePaymentDate = async (field: 'start' | 'end') => {
    const currentDate = field === 'start' ? paymentStartDate : paymentEndDate;
    try {
      const selectedDate = await screenMonitor.showDatePicker(currentDate);
      if (!selectedDate) {
        return;
      }
      if (field === 'start') {
        setPaymentStartDate(selectedDate);
        if (selectedDate > paymentEndDate) {
          setPaymentEndDate(selectedDate);
        }
      } else {
        setPaymentEndDate(selectedDate);
        if (selectedDate < paymentStartDate) {
          setPaymentStartDate(selectedDate);
        }
      }
      setPaymentDataError(null);
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
    }
  };

  const deletePayment = async (timestamp: number) => {
    try {
      await screenMonitor.deletePayment(timestamp);
      setPayments(current =>
        current.filter(payment => payment.timestamp !== timestamp),
      );
      setPaymentDataError(null);
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
    }
  };

  const savePixConfig = async () => {
    setPixConfigBusy(true);
    try {
      await screenMonitor.setPixConfig(
        pixKeyInput,
        pixNameInput,
        pixCityInput,
      );
      setPaymentDataError(null);
    } catch (error) {
      setPaymentDataError(getErrorMessage(error));
    } finally {
      setPixConfigBusy(false);
    }
  };

  const accessibilityEnabled = status?.accessibilityEnabled ?? false;
  const monitoring = status?.monitoring ?? false;
  const filteredPayments = payments.filter(payment => {
    const paymentDate = getLocalDateValue(new Date(payment.timestamp));
    return paymentDate >= paymentStartDate && paymentDate <= paymentEndDate;
  });
  const filteredPaymentTotal = filteredPayments.reduce(
    (total, payment) => total + payment.amount,
    0,
  );
  const suggestedPaymentAmount = parsePaymentAmount(paymentSuggestedFare);
  const promptPaymentPresets = [
    ...(suggestedPaymentAmount === null ? [] : [suggestedPaymentAmount]),
    ...paymentPresets.filter(value => value !== suggestedPaymentAmount),
  ];
  const paymentQrSize = Math.max(
    180,
    Math.min(windowSize.width - 68, 420),
  );

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

        <View style={styles.tabBar}>
          <TabButton
            label="Configurações"
            selected={activeTab === 'settings'}
            onPress={() => setActiveTab('settings')}
          />
          <TabButton
            label="Histórico"
            selected={activeTab === 'feedback'}
            onPress={() => setActiveTab('feedback')}
          />
        </View>

        {fareSignal ? (
          <View
            style={[
              styles.fareSignalCard,
              {backgroundColor: fareSignal.backgroundColor},
            ]}>
            <Text style={styles.fareSignalTitle}>
              FAROL DE VALORES · {fareSignal.classification.toUpperCase()}
            </Text>
            <Text style={styles.fareSignalFare}>{fareSignal.fareLabel}</Text>
            <Text style={styles.fareSignalDetail}>
              {fareSignal.distanceLabel} · {fareSignal.timeLabel}
            </Text>
            <Text style={styles.fareSignalDetail}>{fareSignal.rateLabel}</Text>
            <Text style={styles.fareSignalSuggestion}>
              SUGESTÃO · {fareSignal.suggestedFareLabel}
            </Text>
          </View>
        ) : null}

        {activeTab === 'settings' ? (
          <>
        {movementMonitor.isAvailable ? (
          <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Odômetro GPS</Text>
            <Text style={styles.odometerDistance}>
              {(odometerStatus.distanceMeters / 1000).toFixed(3)} km
            </Text>
            <Text style={styles.body}>
              {odometerStatus.running
                ? odometerStatus.hasFix
                  ? 'GPS ativo; a distância é atualizada conforme o deslocamento confirmado.'
                  : 'Buscando a primeira posição GPS. A medição começa quando o sinal estiver disponível.'
                : 'Inicie para medir a distância percorrida durante uma corrida.'}
            </Text>
            <Text style={styles.privacyNote}>
              Usa localização precisa; leituras imprecisas, saltos improváveis e
              oscilações menores que a margem de ruído do GPS são descartados.
            </Text>
            {odometerError ? (
              <Text style={styles.errorText}>{odometerError}</Text>
            ) : null}
            <ActionButton
              label="Iniciar odômetro"
              disabled={odometerBusy || odometerStatus.running}
              onPress={startOdometer}
            />
            <ActionButton
              label="Parar odômetro"
              disabled={odometerBusy || !odometerStatus.running}
              onPress={stopOdometer}
              secondary
            />
            <ActionButton
              label="Limpar distância"
              disabled={odometerBusy}
              onPress={clearOdometer}
              secondary
            />
          </View>
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  movementStatus.state === 'moving'
                    ? styles.statusDotActive
                    : movementStatus.state === 'stopped'
                      ? styles.movementStoppedDot
                      : styles.statusDotInactive,
                ]}
              />
              <Text style={styles.cardTitle}>
                {movementStatus.state === 'moving'
                ? 'Em movimento'
                  : movementStatus.state === 'stopped'
                  ? 'Parado'
                    : movementEnabled
                      ? 'Detectando movimento'
                      : 'Detecção de movimento pausada'}
              </Text>
            </View>
            <Text style={styles.body}>
              {movementEnabled
                ? movementStatus.state === 'unknown'
                  ? 'Aguardando dados dos sensores ou do GPS.'
                  : `Identificação por ${
                      movementStatus.source === 'gps'
                        ? 'GPS'
                        : 'sensor de movimento do Android'
                    }.`
                : 'Ative para identificar se o veículo está em movimento ou parado.'}
            </Text>
            {Platform.OS === 'android' && Number(Platform.Version) >= 29 ? (
              <Text style={styles.privacyNote}>
                O Android pode solicitar acesso à atividade física e à
                localização. O GPS é usado como fallback quando o sensor não
                fornece dados suficientes.
              </Text>
            ) : null}
            <ActionButton
              label={
                movementEnabled
                  ? 'Pausar detecção'
                  : 'Iniciar detecção de movimento'
              }
              disabled={movementBusy}
              onPress={toggleMovementDetection}
              secondary={movementEnabled}
            />
          </View>
          </>
        ) : null}

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
              <Text style={styles.cardTitle}>Tarifa por quilômetro</Text>
              <Text style={styles.body}>
                Define o valor sugerido no farol. Padrão: R$ 1,50 por km.
              </Text>
              <View style={styles.rateInputRow}>
                <Text style={styles.ratePrefix}>R$</Text>
                <TextInput
                  accessibilityLabel="Tarifa desejada por quilômetro"
                  editable={driverRateReady && !driverRateBusy}
                  keyboardType="decimal-pad"
                  onChangeText={setDriverRateInput}
                  value={driverRateInput}
                  style={styles.rateInput}
                />
                <Text style={styles.rateSuffix}>/km</Text>
              </View>
              {driverRateError ? (
                <Text style={styles.errorText}>{driverRateError}</Text>
              ) : null}
              <ActionButton
                label={
                  !driverRateReady
                    ? 'Carregando tarifa...'
                    : driverRateBusy
                      ? 'Salvando tarifa...'
                      : 'Salvar tarifa'
                }
                disabled={driverRateBusy || !driverRateReady}
                onPress={saveDriverRate}
              />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Atalhos de recebimento</Text>
              <Text style={styles.body}>
                Edite os valores rápidos exibidos na tela de recebimento.
              </Text>
              <View style={styles.presetInputRow}>
                <Text style={styles.ratePrefix}>R$</Text>
                <TextInput
                  accessibilityLabel="Novo atalho de recebimento"
                  keyboardType="decimal-pad"
                  onChangeText={setPaymentPresetInput}
                  placeholder="Ex.: 12,50"
                  placeholderTextColor={colors.muted}
                  value={paymentPresetInput}
                  style={styles.presetInput}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={addPaymentPreset}
                  style={({pressed}) => [
                    styles.presetAddButton,
                    pressed && styles.pressedButton,
                  ]}>
                  <Text style={styles.presetAddButtonText}>Adicionar</Text>
                </Pressable>
              </View>
              {paymentPresets.length === 0 ? (
                <Text style={styles.mutedText}>Nenhum atalho cadastrado.</Text>
              ) : (
                <View style={styles.presetList}>
                  {paymentPresets.map(preset => (
                    <View key={preset} style={styles.presetChip}>
                      <Text style={styles.presetChipText}>
                        {formatCurrency(preset)}
                      </Text>
                      <Pressable
                        accessibilityLabel={`Remover atalho ${formatCurrency(preset)}`}
                        accessibilityRole="button"
                        onPress={() =>
                          savePaymentPresets(
                            paymentPresets.filter(value => value !== preset),
                          )
                        }
                        style={styles.presetRemoveButton}>
                        <Text style={styles.presetRemoveButtonText}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              {paymentDataError ? (
                <Text style={styles.errorText}>{paymentDataError}</Text>
              ) : null}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recebimento Pix</Text>
              <View style={styles.pixConfigFields}>
                <TextInput
                  accessibilityLabel="Chave Pix"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={77}
                  onChangeText={setPixKeyInput}
                  placeholder="Chave Pix"
                  placeholderTextColor={colors.muted}
                  value={pixKeyInput}
                  style={styles.pixConfigInput}
                />
                <TextInput
                  accessibilityLabel="Nome do recebedor Pix"
                  maxLength={25}
                  onChangeText={setPixNameInput}
                  placeholder="Nome do recebedor"
                  placeholderTextColor={colors.muted}
                  value={pixNameInput}
                  style={styles.pixConfigInput}
                />
                <TextInput
                  accessibilityLabel="Cidade do recebedor Pix"
                  autoCapitalize="characters"
                  maxLength={15}
                  onChangeText={setPixCityInput}
                  placeholder="Cidade"
                  placeholderTextColor={colors.muted}
                  value={pixCityInput}
                  style={styles.pixConfigInput}
                />
              </View>
              {paymentDataError ? (
                <Text style={styles.errorText}>{paymentDataError}</Text>
              ) : null}
              <ActionButton
                label={pixConfigBusy ? 'Salvando...' : 'Salvar dados Pix'}
                disabled={pixConfigBusy}
                onPress={savePixConfig}
                secondary
              />
            </View>
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

          </>
        )}
          </>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Histórico de pagamentos</Text>
              <Text style={styles.mutedText}>
                {filteredPayments.length}{' '}
                {filteredPayments.length === 1 ? 'corrida' : 'corridas'}
              </Text>
            </View>
            <ActionButton
              label="Adicionar pagamento manualmente"
              disabled={!screenMonitor.isAvailable || status === null || busy}
              onPress={addManualPayment}
            />
            <View style={styles.paymentFilters}>
              <Pressable
                accessibilityLabel={`Data inicial ${formatDateValue(paymentStartDate)}`}
                accessibilityRole="button"
                onPress={() => choosePaymentDate('start')}
                style={styles.paymentDateInput}>
                <Text style={styles.paymentDateLabel}>De</Text>
                <Text style={styles.paymentDateValue}>
                  {formatDateValue(paymentStartDate)}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Data final ${formatDateValue(paymentEndDate)}`}
                accessibilityRole="button"
                onPress={() => choosePaymentDate('end')}
                style={styles.paymentDateInput}>
                <Text style={styles.paymentDateLabel}>Até</Text>
                <Text style={styles.paymentDateValue}>
                  {formatDateValue(paymentEndDate)}
                </Text>
              </Pressable>
            </View>
            <View style={styles.paymentTotal}>
              <Text style={styles.paymentTotalLabel}>Total</Text>
              <Text style={styles.paymentTotalValue}>
                {formatCurrency(filteredPaymentTotal)}
              </Text>
            </View>
            {paymentDataError ? (
              <View style={[styles.card, styles.errorCard]}>
                <Text style={styles.errorText}>{paymentDataError}</Text>
              </View>
            ) : null}
            {filteredPayments.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.body}>
                  {payments.length === 0
                    ? 'Os pagamentos confirmados aparecerão aqui.'
                    : 'Nenhum pagamento corresponde aos filtros.'}
                </Text>
              </View>
            ) : (
              filteredPayments.map(payment => (
                <View key={payment.timestamp} style={styles.paymentHistoryRow}>
                  <View style={styles.paymentHistoryCopy}>
                    <Text style={styles.paymentHistoryTitle}>
                      Corrida recebida
                    </Text>
                    <Text style={styles.mutedText}>
                      {new Date(payment.timestamp).toLocaleString('pt-BR')}
                    </Text>
                  </View>
                  <Text style={styles.paymentHistoryAmount}>
                    {formatCurrency(payment.amount)}
                  </Text>
                  <Pressable
                    accessibilityLabel="Excluir corrida do histórico"
                    accessibilityRole="button"
                    onPress={() => deletePayment(payment.timestamp)}
                    style={styles.paymentDeleteButton}>
                    <Text style={styles.paymentDeleteText}>Excluir</Text>
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!paymentSaving) {
            closePaymentPrompt();
          }
        }}
        statusBarTranslucent={false}
        transparent
        visible={paymentPromptVisible}>
        <View style={styles.paymentModalRoot}>
          <Pressable
            accessibilityLabel="Cancelar recebimento"
            accessibilityRole="button"
            disabled={paymentSaving}
            onPress={closePaymentPrompt}
            style={StyleSheet.absoluteFill}
          />
          <ScrollView
            contentContainerStyle={styles.paymentModalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View
              style={[
                styles.paymentModalCard,
                {
                  maxHeight: windowSize.height - 64,
                  width: Math.min(windowSize.width - 32, 500),
                },
              ]}>
              <Animated.Text
                style={[
                  styles.paymentModalStatus,
                  {opacity: paymentStatusOpacity},
                ]}>
                {paymentCurrentAmount === null
                  ? 'Aguardando pagamento...'
                  : `Receber ${formatCurrency(paymentCurrentAmount)}`}
              </Animated.Text>

              {paymentEntryVisible ? (
                <View style={styles.paymentEntryPanel}>
                  <View style={styles.paymentAmountRow}>
                    <Text style={styles.paymentAmountPrefix}>R$</Text>
                    <TextInput
                      ref={paymentAmountInputRef}
                      accessibilityLabel="Valor a receber"
                      keyboardType="decimal-pad"
                      onChangeText={setPaymentAmountInput}
                      onSubmitEditing={() =>
                        selectPaymentAmount(
                          parsePaymentAmount(paymentAmountInput),
                        )
                      }
                      placeholder="0,00"
                      placeholderTextColor={colors.muted}
                      returnKeyType="done"
                      value={paymentAmountInput}
                      style={styles.paymentAmountInput}
                    />
                    <Pressable
                      accessibilityLabel="Limpar valor"
                      accessibilityRole="button"
                      onPress={() => {
                        setPaymentAmountInput('');
                        setPaymentAmountError(null);
                      }}
                      style={styles.paymentAmountClear}>
                      <Text style={styles.paymentAmountClearText}>×</Text>
                    </Pressable>
                  </View>
                  {paymentAmountError ? (
                    <Text style={styles.paymentModalError}>
                      {paymentAmountError}
                    </Text>
                  ) : null}
                  {paymentQrError ? (
                    <Text style={styles.paymentModalError}>
                      {paymentQrError}
                    </Text>
                  ) : null}
                  <ScrollView
                    contentContainerStyle={styles.paymentPresetRow}
                    horizontal
                    showsHorizontalScrollIndicator={false}>
                    {promptPaymentPresets.map(amount => (
                      <Pressable
                        key={amount}
                        accessibilityRole="button"
                        onPress={() => selectPaymentAmount(amount)}
                        style={styles.paymentPresetButton}>
                        <Text style={styles.paymentPresetButtonText}>
                          {formatCurrency(amount)}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <ActionButton
                    label="Usar valor"
                    disabled={paymentQrLoading}
                    onPress={() =>
                      selectPaymentAmount(
                        parsePaymentAmount(paymentAmountInput),
                      )
                    }
                  />
                </View>
              ) : (
                <>
                  {paymentQr && !paymentQrLoading ? (
                    <Image
                      accessibilityLabel="QR Code Pix"
                      resizeMode="contain"
                      source={{uri: paymentQr}}
                      style={[
                        styles.paymentQrImage,
                        {height: paymentQrSize, width: paymentQrSize},
                      ]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.paymentQrPlaceholder,
                        {height: paymentQrSize, width: paymentQrSize},
                      ]}>
                      <Text style={styles.paymentModalMessage}>
                        {paymentQrLoading
                          ? 'Gerando QR Code...'
                          : 'QR Code indisponível'}
                      </Text>
                    </View>
                  )}
                  {paymentQrError ? (
                    <Text style={styles.paymentModalError}>
                      {paymentQrError}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setPaymentEntryVisible(true);
                      setPaymentAmountError(null);
                      setTimeout(() => paymentAmountInputRef.current?.focus(), 100);
                    }}
                    style={styles.paymentInformButton}>
                    <Text style={styles.paymentInformText}>Informar valor</Text>
                  </Pressable>
                </>
              )}

              <ActionButton
                label={
                  paymentSaving ? 'Salvando...' : 'Confirmar pagamento'
                }
                disabled={paymentSaving}
                onPress={confirmPayment}
              />
              <ActionButton
                label="Cancelar"
                disabled={paymentSaving}
                onPress={closePaymentPrompt}
                secondary
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
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

function formatCurrency(amount: number) {
  return `R$ ${amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function TabButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{selected}}
      onPress={onPress}
      style={({pressed}) => [
        styles.tabButton,
        selected && styles.selectedTabButton,
        pressed && styles.pressedButton,
      ]}>
      <Text style={[styles.tabButtonText, selected && styles.selectedTabButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
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
  tabBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: '#E8EEEB',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 10,
  },
  selectedTabButton: {
    backgroundColor: colors.accent,
  },
  tabButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  selectedTabButtonText: {
    color: '#FFFFFF',
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
  fareSignalCard: {
    borderRadius: 16,
    marginBottom: 16,
    padding: 18,
  },
  fareSignalTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  fareSignalFare: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 6,
  },
  fareSignalDetail: {
    color: '#FFFFFF',
    fontSize: 14,
    marginTop: 5,
  },
  fareSignalSuggestion: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 10,
  },
  odometerDistance: {
    color: colors.accent,
    fontSize: 36,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    marginTop: 10,
  },
  rateInputRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#F3F6F5',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  ratePrefix: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '600',
  },
  rateInput: {
    color: colors.ink,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    minWidth: 90,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: 'right',
  },
  rateSuffix: {
    color: colors.muted,
    fontSize: 14,
  },
  presetInputRow: {
    alignItems: 'center',
    backgroundColor: '#F3F6F5',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 14,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  presetInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  presetAddButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  presetAddButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  pixConfigFields: {
    gap: 10,
    marginTop: 14,
  },
  pixConfigInput: {
    backgroundColor: '#F3F6F5',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  presetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  presetChip: {
    alignItems: 'center',
    backgroundColor: '#EDF3F0',
    borderRadius: 18,
    flexDirection: 'row',
    minHeight: 38,
    paddingLeft: 12,
    paddingRight: 4,
  },
  presetChipText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  presetRemoveButton: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    marginLeft: 5,
    width: 30,
  },
  presetRemoveButtonText: {
    color: colors.muted,
    fontSize: 22,
    lineHeight: 24,
  },
  paymentFilters: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    marginTop: 16,
  },
  paymentDateInput: {
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: 10,
  },
  paymentDateLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  paymentDateValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  paymentTotal: {
    alignItems: 'center',
    backgroundColor: '#E8F3EE',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  paymentTotalLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  paymentTotalValue: {
    color: colors.accent,
    fontSize: 19,
    fontWeight: '700',
  },
  paymentHistoryRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    padding: 16,
  },
  paymentHistoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentHistoryTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  paymentHistoryAmount: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  paymentDeleteButton: {
    alignItems: 'center',
    backgroundColor: '#FCEFED',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 9,
  },
  paymentDeleteText: {
    color: '#A63D35',
    fontSize: 12,
    fontWeight: '700',
  },
  paymentModalRoot: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    flex: 1,
    justifyContent: 'center',
  },
  paymentModalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  paymentModalCard: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
  },
  paymentModalStatus: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  paymentQrImage: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
  },
  paymentQrPlaceholder: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#F3F6F5',
    justifyContent: 'center',
    padding: 20,
  },
  paymentModalMessage: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  paymentModalError: {
    color: '#A63D35',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  paymentInformButton: {
    alignSelf: 'center',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  paymentInformText: {
    color: colors.accent,
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  paymentEntryPanel: {
    marginBottom: 4,
  },
  paymentAmountRow: {
    alignItems: 'center',
    backgroundColor: '#F3F6F5',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 12,
  },
  paymentAmountPrefix: {
    color: colors.muted,
    fontSize: 17,
    fontWeight: '700',
  },
  paymentAmountInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    minWidth: 0,
    paddingHorizontal: 10,
  },
  paymentAmountClear: {
    alignItems: 'center',
    backgroundColor: '#E8EEEB',
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  paymentAmountClearText: {
    color: colors.ink,
    fontSize: 25,
    lineHeight: 28,
  },
  paymentPresetRow: {
    gap: 8,
    paddingVertical: 10,
  },
  paymentPresetButton: {
    alignItems: 'center',
    backgroundColor: '#EDF3F0',
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  paymentPresetButtonText: {
    color: colors.accent,
    fontSize: 14,
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
  movementStoppedDot: {
    backgroundColor: '#66736E',
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
