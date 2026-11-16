# Copiloto

Aplicativo Android em React Native e TypeScript que observa mudanças relevantes
na tela, combina a árvore de acessibilidade com OCR do Google ML Kit e exibe os
resultados em tempo real. O processamento é local e só começa quando o usuário
ativa o monitoramento.

## Requisitos

- Node.js 22.11 ou superior e npm.
- JDK 17 ou superior.
- Android Studio com Android SDK Platform 37, Build Tools 37 e um emulador ou
  dispositivo Android.

O template também inclui o projeto iOS do React Native, mas a captura de tela
depende do serviço de acessibilidade do Android e não está disponível no iOS.

## Instalação e execução

```sh
npm install
npm start
```

Em outro terminal, com um dispositivo ou emulador conectado:

```sh
npm run android
```

No Windows, configure `JAVA_HOME` para apontar para um JDK 17+ e verifique
`ANDROID_HOME` antes de executar o Gradle.

## Ativar a captura

1. Abra o Copiloto e toque em **Abrir configurações de acessibilidade**.
2. Habilite **Copiloto - captura de tela** nas configurações do Android e volte
   ao aplicativo.
3. Toque em **Iniciar captura**. O serviço só analisa telas enquanto essa opção
   estiver ativa; somente os pacotes listados em
   [`TargetAppPackages.kt`](./android/app/src/main/java/com/copiloto/TargetAppPackages.kt)
   podem ser analisados. Use **Pausar captura** para interromper.
4. Abra um dos apps listados como alvo. A tela mais recente e os textos
   reconhecidos aparecem no painel.

O serviço reage a cliques, foco, seleção, rolagem e mudanças de conteúdo/texto.
Cada novo evento relevante reinicia um debounce de 800 ms; a árvore de
acessibilidade e o OCR só são lidos depois desse intervalo sem novas
interações, dando tempo para a tela terminar de renderizar. Análises antigas são
descartadas quando outra mudança chega ou outro pacote passa para primeiro
plano. Um fingerprint do conteúdo normalizado evita publicar novamente uma
tela sem mudanças.

## Detecção de movimento

Na tela inicial, **Iniciar detecção de movimento** habilita a identificação do
estado sem exibir velocidade. O limiar está temporariamente em **1 km/h** para
testar caminhando; para uso real, configure **20 km/h**. Detalhes do fluxo,
recursos Android, filtragem, permissões, constantes e instruções de teste estão
na [documentação do detector](./docs/MOVEMENT_DETECTOR.md).

O painel Android também oferece um odômetro GPS de teste com ações para
iniciar, parar e limpar a distância. O valor é atualizado em quilômetros e a
filtragem descarta posições imprecisas e saltos improváveis. A distância ainda
não é persistida nem associada às telas reconhecidas.

## Captura e modelo de dados

- O serviço coleta textos, descrições, classe e ID de recurso em
  `AccessibilityNodeInfo`, limitando a leitura a 500 nós por análise.
- O allowlist nativo fica em `TargetAppPackages.packages`; atualmente inclui
  `com.app99.driver` (99 Motorista) e `com.sec.android.gallery3d` (Samsung
  Galeria). Para incluir outro app, adicione o ID exato do pacote Android e
  recompile/reinstale o app. Pacotes fora da lista não iniciam captura nem OCR
  e não geram eventos para a interface.
- No Android 11 ou superior, também solicita uma captura de tela e executa o
  reconhecedor de texto latino do ML Kit. Em versões anteriores, os dados de
  acessibilidade continuam disponíveis e o OCR é marcado como indisponível.
- Falhas de captura/OCR são reportadas no evento; não descartam dados que já
  vieram da acessibilidade.
- `ScreenElement` preserva `source` (`accessibility` ou `ocr`), limites em
  pixels absolutos da tela, confiança do OCR e metadados opcionais.
- Observações de fontes diferentes na mesma região são mantidas. O modelo as
  liga por `duplicateGroupId` e marca textos divergentes com `textConflict`,
  sem substituir um valor pelo outro.
- Os resultados são enviados ao React Native pelo evento nativo `screenData`.
  O app não persiste capturas; por padrão, o texto permanece no dispositivo.
  Quando o painel WebSocket é configurado e conectado, o texto reconhecido é
  transmitido ao servidor indicado.
- As telas conhecidas ficam centralizadas em
  [`screenRegistry.ts`](./src/screen/screenRegistry.ts), com regras de texto
  para identificação e campos predefinidos para extração, sem depender de
  bounds/posição na tela. Os textos que identificam a tela não são considerados valores
  extraídos. O provider `ride-completion` extrai somente o valor monetário
  (`rideValue`) a partir do formato monetário reconhecido. O provider
  `ride-offer` extrai categoria, valor da corrida,
  tempo e distância até o embarque e tempo e distância até o destino, cada qual
  a partir dos padrões de texto definidos.
  A identificação roda somente quando chega uma observação alterada; o debounce
  e o fingerprint do serviço Android evitam polling ou reprocessamento de telas
  sem mudanças. As palavras encontradas e telas identificadas são enviadas ao
  painel web quando o WebSocket está conectado; o app não mostra esse conteúdo.
  Ao identificar uma tela de encerramento, o app é trazido para primeiro plano
  e exibe a tela de pagamento dentro da própria interface, sem janelas de
  sobreposição.
  **Informar valor** alterna o QR pelos atalhos e campo de valor; ao escolher
  um atalho ou confirmar um valor digitado, o QR é atualizado com o valor e o
  status indica quanto receber. O valor extraído pelo OCR aparece como primeiro
  atalho; ao usar o valor, o teclado fecha automaticamente. **Confirmar
  pagamento** registra o valor no histórico local e **Cancelar** fecha a tela
  sem registrar. O teclado permanece no contexto normal do app. Nas abas
  **Configurações** e **Histórico**, é possível configurar a chave, o nome e a
  cidade Pix, gerenciar os atalhos, abrir a tela para um pagamento manual e
  filtrar pagamentos por intervalo de datas. O filtro inicia no dia atual e
  permite escolher as datas em um calendário; o total acompanha os pagamentos
  exibidos. O BR Code gerado remove máscaras de chaves numéricas e normaliza
  nome/cidade para texto sem acentos. O app não inicia uma transferência.
- Ao reconhecer uma oferta, o farol de valores aparece no painel do próprio
  app: o valor da corrida dividido pela distância total
  (embarque + destino), junto com distância e tempo totais. Abaixo de
  R$ 1,30/km é ruim (vermelho), de R$ 1,30/km até menos de R$ 1,50/km é média
  (amarelo) e a partir de R$ 1,50/km é boa (verde). A tarifa desejada do motorista é
  ajustável na interface; o farol mostra o valor sugerido pela distância total
  vezes essa tarifa. Consulte a
  [documentação do farol](./docs/FARE_SIGNAL.md) para detalhes da implementação,
  parâmetros ajustáveis e limitações conhecidas.

## Painel web em tempo real

O servidor WebSocket e a página HTML ficam isolados em [`monitor-server/`](./monitor-server/).
O painel conecta automaticamente ao servidor e exibe a última tela do pacote
alvo. Não há token, cadastro ou configuração de conexão na página.

Inicie o servidor:

```powershell
cd monitor-server
npm install
npm start
```

Abra `http://localhost:8080` no navegador. No emulador Android padrão,
`ws://10.0.2.2:8080/ws` já aponta para o computador. Em um telefone, troque
`10.0.2.2` pela URL local do computador em
[`monitorServer.ts`](./src/config/monitorServer.ts) e recompile o app. Inicie a
captura e navegue em um dos apps-alvo para acompanhar os textos e suas origens
ao vivo.

O servidor aceita apenas pacotes configurados em `COPILOTO_TARGET_PACKAGES`
(padrão `com.app99.driver`) e mantém a última tela somente em memória. Para
acompanhar também a Samsung Galeria no painel, configure a lista antes de
iniciar o servidor:

```powershell
$env:COPILOTO_TARGET_PACKAGES = "com.app99.driver,com.sec.android.gallery3d"
npm start
```

Essa configuração vale para o terminal atual. Não há autenticação nem
criptografia: use apenas em uma rede confiável e não exponha a porta à internet.

Para testar o servidor:

```powershell
cd monitor-server
npm test
```

## Validação

```sh
npm test -- --runInBand
npm run lint
npx tsc --noEmit
```
