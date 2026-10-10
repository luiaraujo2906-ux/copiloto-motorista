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
4. Abra o 99 Motorista. A tela mais recente e os textos reconhecidos aparecem
   no painel.

O serviço reage a cliques, foco, seleção, rolagem e mudanças de conteúdo/texto.
Cada novo evento relevante reinicia um debounce de 800 ms; a árvore de
acessibilidade e o OCR só são lidos depois desse intervalo sem novas
interações, dando tempo para a tela terminar de renderizar. Análises antigas são
descartadas quando outra mudança chega ou outro pacote passa para primeiro
plano. Um fingerprint do conteúdo normalizado evita publicar novamente uma
tela sem mudanças.

## Captura e modelo de dados

- O serviço coleta textos, descrições, classe e ID de recurso em
  `AccessibilityNodeInfo`, limitando a leitura a 500 nós por análise.
- O allowlist inicial contém apenas `com.app99.driver` (99 Motorista). Para incluir ou
  substituir um app da 99, edite `TargetAppPackages.packages` com o ID exato do
  pacote Android e recompile. Pacotes fora da lista não iniciam captura nem OCR
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
captura e navegue no 99 Motorista para acompanhar os textos e suas origens ao
vivo.

O servidor aceita apenas pacotes configurados em `COPILOTO_TARGET_PACKAGES`
(padrão `com.app99.driver`) e mantém a última tela somente em memória. Não há
autenticação nem criptografia: use apenas em uma rede confiável e não exponha a
porta à internet.

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
