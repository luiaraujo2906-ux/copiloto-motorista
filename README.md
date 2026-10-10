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

O serviço ignora o próprio Copiloto, agrupa eventos relevantes com debounce de
350 ms e descarta análises antigas quando uma nova tela fica disponível ou
quando outro pacote passa para primeiro plano. Um fingerprint do conteúdo
normalizado evita publicar novamente uma tela sem mudanças.

## Captura e modelo de dados

- O serviço coleta textos, descrições, classe e ID de recurso em
  `AccessibilityNodeInfo`, limitando a leitura a 500 nós por análise.
- O allowlist inicial contém apenas `com.taxis99.driver`. Para incluir ou
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
  Nenhuma imagem ou texto é persistido ou enviado pela rede pelo aplicativo.

## Validação

```sh
npm test -- --runInBand
npm run lint
npx tsc --noEmit
```
