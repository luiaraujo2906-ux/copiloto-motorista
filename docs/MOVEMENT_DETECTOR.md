# Detector de movimento

Este documento descreve a implementação Android em
`android/app/src/main/java/com/copiloto/MovementMonitorModule.kt` e sua
integração com React Native em `src/native/movementMonitor.ts`.

## Odômetro GPS

O painel Android também inclui um odômetro de teste com controles para iniciar,
parar e limpar a distância. A medição é mantida em metros no módulo nativo e
apresentada em quilômetros com três casas decimais. Parar preserva o valor;
limpar zera o valor e a referência GPS atual, inclusive durante uma medição.

O odômetro solicita atualizações dos provedores GPS e rede habilitados, em
intervalos de um segundo, e só considera amostras com precisão reportada de até
50 metros e intervalos monotônicos de no máximo 30 segundos. Se a posição não
trouxer timestamp monotônico (como pode acontecer com posições simuladas), o
horário de recebimento é usado. Saltos acima de 70 m/s são rejeitados e
reiniciam a referência para evitar que uma posição fora de lugar seja contada
mais tarde.

O filtro mantém como referência a última posição que confirmou deslocamento.
Assim, segmentos curtos não são descartados isoladamente: o deslocamento pode
se acumular até superar a margem de ruído, baseada em 25% da soma das precisões
reportadas, limitada entre dois e cinco metros. A margem é subtraída ao
confirmar o segmento. Isso permite registrar deslocamentos lentos sem somar
cada oscilação do GPS parado. O painel informa quando uma primeira posição foi
recebida. GPS depende do dispositivo, do ambiente e da qualidade do sinal, então
essa filtragem reduz leituras falsas, mas não substitui validação em campo.
O odômetro não salva corridas ainda; a integração com as telas reconhecidas
poderá ser adicionada posteriormente.

## O que o detector informa

O detector publica somente um estado, sem mostrar nem transmitir velocidade:

- `unknown`: ainda não há amostras suficientes ou a localização não está
  disponível.
- `moving`: movimento confirmado.
- `stopped`: ausência de movimento confirmada.

Também identifica a origem do estado (`motion_sensor`, `gps` ou `none`). A
interface apresenta os estados como **Em movimento**, **Parado** ou
**Detectando movimento**. O monitor só funciona no Android e inicia quando a
pessoa toca em **Iniciar detecção de movimento**; **Pausar detecção** cancela os
listeners ativos.

## Recursos utilizados

### Sensor de passos Android

O módulo procura `Sensor.TYPE_STEP_DETECTOR`, que gera eventos de passos sem
precisar manter uma leitura contínua de acelerômetro. Essa é a opção de menor
custo para reconhecer que uma pessoa está caminhando durante o teste.

No modo de teste atual, três eventos de passo dentro de uma janela de quatro
segundos classificam o estado como `moving`. Se não houver novos eventos por
quatro segundos, o estado originado pelo sensor passa para `stopped`.

O sensor não mede velocidade de veículo nem distingue uma pessoa caminhando de
um veículo em movimento. Por isso, seu uso como decisão de estado está limitado
ao modo de teste; quando a configuração é alterada para o limiar de veículo, a
decisão passa a ser feita pelo GPS.

### GPS como fallback

O GPS é usado se o sensor de passos não estiver disponível/autorizado ou se não
produzir eventos por pelo menos oito segundos. Fora do modo de teste, o GPS é
iniciado desde o começo. As atualizações são solicitadas ao provedor GPS a cada
três segundos.

São aceitas somente posições com precisão reportada de até 25 metros e com
velocidade fornecida pelo Android (`Location.hasSpeed()`). A velocidade é
convertida internamente de m/s para km/h, suavizada pela mediana das três
últimas amostras e comparada ao limiar:

- velocidade filtrada **maior ou igual ao limiar**: candidata a `moving`;
- velocidade filtrada **menor que o limiar**: candidata a `stopped`.

O estado só muda após três amostras GPS consecutivas do mesmo lado do limiar.
Valores sem precisão suficiente não entram na filtragem nem na contagem de
confirmação. Assim, uma leitura isolada ou um pico de GPS não altera o estado.
Quando o GPS é desabilitado, o módulo publica `unknown`.

## Constantes configuráveis

As constantes ficam no `companion object` de `MovementMonitorModule.kt`:

| Constante | Atual | Função |
| --- | ---: | --- |
| `MOVEMENT_THRESHOLD_KMH` | `1.0f` | Limiar aplicado às leituras GPS. Igual ou acima significa movimento; abaixo significa parado. |
| `WALKING_TEST_MAX_THRESHOLD_KMH` | `5.0f` | Até esse limiar, habilita a detecção de caminhada por passos para facilitar o teste manual. |
| `METERS_PER_SECOND_TO_KMH` | `3.6f` | Fator para converter velocidade GPS de m/s para km/h. |
| `MAX_GPS_ACCURACY_METERS` | `25f` | Precisão máxima aceita para uma amostra GPS. |
| `GPS_UPDATE_INTERVAL_MILLIS` | `3_000L` | Intervalo solicitado entre atualizações GPS. |
| `GPS_FALLBACK_DELAY_MILLIS` | `8_000L` | Tempo sem eventos do sensor antes de iniciar o GPS em modo de teste. |
| `GPS_SMOOTHING_SAMPLE_COUNT` | `3` | Quantidade de amostras usada para calcular a mediana da velocidade GPS. |
| `GPS_CONFIRMATION_SAMPLES` | `3` | Amostras consecutivas necessárias para confirmar o estado pelo GPS. |
| `REQUIRED_STEPS` | `3` | Eventos de passo necessários para indicar movimento no teste. |
| `STEP_WINDOW_MILLIS` | `4_000L` | Janela em que os passos são contados. |
| `STEP_QUIET_TIMEOUT_MILLIS` | `4_000L` | Período sem passos para considerar encerrado o movimento detectado pelo sensor. |

### Modo de teste e regra de veículo

O limiar atual de `1 km/h` é intencionalmente baixo para permitir verificar a
interface caminhando. Enquanto `MOVEMENT_THRESHOLD_KMH` for menor ou igual a
`WALKING_TEST_MAX_THRESHOLD_KMH`, eventos de passo podem indicar movimento sem
que o GPS esteja ativo.

Para aplicar a regra de veículo solicitada, altere
`MOVEMENT_THRESHOLD_KMH` para `20.0f`. Com o limiar acima de 5 km/h, o sensor
de passos deixa de classificar caminhada como movimento e a classificação passa
a depender de leituras GPS: **20 km/h ou mais é movimento; menos de 20 km/h é
parado**. A confirmação exige três amostras válidas consecutivas, portanto há
um pequeno atraso intencional para rejeitar ruído.

## Permissões e desempenho

O manifesto Android declara `ACCESS_FINE_LOCATION` e `ACTIVITY_RECOGNITION`.
Ao iniciar a detecção, o app solicita localização precisa e, no Android 10
(API 29) ou superior, permissão de atividade física. A localização é
obrigatória para habilitar o fallback GPS; se for negada, o detector apresenta
um erro em vez de iniciar sem fallback. Sem permissão de atividade física ou
sem sensor compatível, o módulo usa GPS desde o início.

Para economizar bateria, o sensor escolhido é o detector de passos, e não uma
amostragem constante do acelerômetro. O GPS só é ligado quando necessário no
modo de teste, e suas atualizações e listeners são removidos ao pausar a
detecção ou invalidar o módulo.

## Fluxo de integração

1. `movementMonitor.start()` solicita permissões e chama o módulo nativo.
2. `MovementMonitorModule` registra sensor e/ou atualizações GPS conforme as
   regras acima.
3. Mudanças confirmadas são emitidas como evento React Native
   `movementChanged`, com `state` e `source`.
4. `movementMonitor.subscribe()` valida o evento e atualiza o estado visual.
5. `movementMonitor.stop()` cancela callbacks e listeners, limpa as amostras e
   volta para `unknown`.

## Teste manual

1. Instale e abra a versão Android do app.
2. Toque em **Iniciar detecção de movimento** e conceda as permissões pedidas.
3. Com o limiar de teste atual, caminhe por alguns passos: a tela deve indicar
   **Em movimento**.
4. Pare e aguarde cerca de quatro segundos sem passos: deve indicar **Parado**.
5. Para testar o modo de veículo, configure `MOVEMENT_THRESHOLD_KMH` em
   `20.0f`, compile/reinstale e teste em um local seguro com localização/GPS
   disponível. A validação real do limiar depende de um dispositivo em
   movimento; o emulador pode não fornecer velocidade GPS representativa.
