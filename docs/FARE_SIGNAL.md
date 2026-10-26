# Farol de valores

O farol de valores estima a tarifa bruta por quilômetro de uma oferta de
corrida. Quando a tela identificada como `ride-offer` contém os dados
necessários, o Android mostra um cartão colorido no topo da tela, inclusive
sobre outros aplicativos. O cartão mostra valor da corrida, distância total,
tempo total, tarifa por quilômetro e classificação. À direita, separado por
uma divisória, aparece o valor sugerido de acordo com a tarifa que o motorista
configurou no app.

## Fluxo de implementação

1. `AccessibilityScreenService` observa eventos de acessibilidade dos pacotes
   permitidos em `TargetAppPackages.kt`. Após 800 ms sem novos eventos
   relevantes, coleta a árvore de acessibilidade e, no Android 11 ou superior,
   captura a tela para OCR com Google ML Kit.
2. `screenModel.ts` combina os resultados de acessibilidade e OCR e identifica
   textos duplicados por sobreposição das áreas. `screenRegistry.ts` reconhece
   a oferta quando encontra categoria (`Moto` ou `Carro`), valor da corrida,
   trecho de embarque e trecho até o destino.
3. `App.tsx` passa os campos extraídos e a tarifa configurada para
   `calculateFareSignal` em `src/screen/fareSignal.ts`. Se os valores forem
   válidos, chama `ScreenMonitor.showFareSignal` pelo módulo nativo. Se a
   observação não resultar em uma oferta calculável, solicita que o popup seja
   ocultado. A tarifa desejada pode ser alterada na seção **Tarifa por
   quilômetro** e é salva pelo módulo nativo nas preferências privadas do app.
4. `ScreenMonitorModule.kt` encaminha a chamada para o serviço de
   acessibilidade. `AccessibilityScreenService.kt` cria uma janela
   `TYPE_ACCESSIBILITY_OVERLAY`, não focalizável e não tocável, no topo da tela.
   A própria permissão do serviço de acessibilidade autoriza esse tipo de
   janela; não é usada a permissão genérica de sobreposição. O conteúdo é uma
   linha horizontal: detalhes e farol ficam à esquerda, enquanto o valor
   sugerido fica à direita com uma divisória vertical.
5. O serviço remove a janela quando o prazo expira, quando recebe uma
   solicitação explícita para ocultar, quando a captura é pausada ou quando
   eventos indicam que um app fora da lista de monitoramento está em primeiro
   plano. Eventos da própria janela do Copiloto são ignorados para não ocultar
   o cartão que acabou de ser mostrado.

## Cálculo e classificação

Valores monetários seguem o formato brasileiro. Distâncias devem ser
reconhecidas com unidade `m` ou `km`; metros são convertidos para quilômetros.

```text
distância total (km) = distância até embarque + distância até destino
tempo total (min)    = tempo até embarque + tempo até destino
tarifa (R$/km)       = valor da corrida (R$) / distância total (km)
valor sugerido (R$)  = distância total (km) * tarifa desejada (R$/km)
```

A classificação usa o resultado sem arredondar:

| Tarifa calculada | Classificação | Fundo |
| --- | --- | --- |
| menor que R$ 1,30/km | Ruim | Vermelho (`#C62828`) |
| de R$ 1,30/km até menos de R$ 1,50/km | Média | Amarelo (`#F9A825`) |
| R$ 1,50/km ou mais | Boa | Verde (`#2E7D32`) |

O valor exibido e os totais são formatados com duas casas decimais. O tempo
total é exibido em minutos inteiros. O cálculo é uma relação bruta entre valor
da oferta e distância estimada; não desconta combustível, manutenção, pedágios,
tempo parado, comissão, impostos ou deslocamentos após o destino.

## Constantes e pontos ajustáveis

| Ajuste | Local | Valor atual | Efeito |
| --- | --- | --- | --- |
| Tempo máximo de exibição | `AccessibilityScreenService.kt`, `FARE_SIGNAL_DURATION_MILLIS` | `10_000L` (10 s) | Tempo até o popup ser removido automaticamente. Uma nova oferta mostrada reinicia o temporizador. |
| Debounce da análise | `AccessibilityScreenService.kt`, `SCREEN_SETTLE_DELAY_MILLIS` | `800L` | Espera após eventos da tela antes de coletar textos e executar OCR. Aumentar pode evitar leitura de telas ainda renderizando, mas atrasa o farol. |
| Limite de nós de acessibilidade | `AccessibilityScreenService.kt`, `maxNodes` | `500` | Limita a quantidade de nós visitados por análise. |
| Limites de classificação | `src/screen/fareSignal.ts`, classificação em `calculateFareSignal` | `1.3` e `1.5` R$/km | Altera as fronteiras entre ruim, média e boa. Atualize também os testes em `fareSignal.test.ts`. |
| Tarifa desejada pelo motorista | App: seção **Tarifa por quilômetro**; persistência em `ScreenMonitorModule.kt` | `1,50` R$/km | Determina o valor sugerido (`distância total * tarifa desejada`). Aceita valores maiores que zero até R$ 1.000,00/km; fica salva nas preferências privadas do Android. |
| Cores | `src/screen/fareSignal.ts`, `backgroundColor` | vermelho `#C62828`, amarelo `#F9A825`, verde `#2E7D32` | Cor retornada pelo cálculo e aplicada ao cartão nativo. |
| Formatos de extração | `src/screen/screenRegistry.ts`, definição `ride-offer` | moeda `R$`, tempo `min`, distância `m`/`km` | Determina quais textos formam uma oferta e quais dois trechos são usados. |
| Apps monitorados | `TargetAppPackages.kt` | lista de pacotes configurada no código | Pacotes fora da lista não são analisados e podem provocar o encerramento do popup ao passarem para primeiro plano. |

O cartão ocupa toda a largura disponível, tem margens horizontais de 16 dp,
deslocamento vertical de 24 dp e margens internas de 8 dp (`dp()` converte os
valores para pixels conforme a densidade do dispositivo). A divisória tem 1 dp
de largura e a área do valor sugerido fica alinhada à direita. Esses valores e
os tamanhos tipográficos são definidos na criação da janela em
`AccessibilityScreenService.kt`.

## Gargalos e limitações

- **Debounce e OCR:** a análise espera o debounce e a captura/OCR do ML Kit
  antes de emitir a observação. Uma oferta pode desaparecer antes de terminar
  o processamento; aumentar o limite de nós ou a frequência de eventos também
  pode elevar o custo de CPU, memória e bateria.
- **Dependência do formato visual:** a extração usa expressões regulares para
  moeda e textos como `7 min (867 m)`. Mudanças de layout, idioma, abreviação,
  pontuação ou texto exibido no app de corrida podem impedir a identificação.
- **Unidade obrigatória no cálculo:** embora a expressão da oferta aceite
  distância sem unidade para identificar a tela, o cálculo exige `m` ou `km`.
  Se OCR/a árvore omitirem a unidade, não haverá farol calculável.
- **Ordem dos dois trechos:** embarque e destino são escolhidos pela ordem em
  que os elementos são retornados (OCR primeiro, depois acessibilidade), e não
  pela posição vertical. Se o app reordenar os elementos ou o OCR encontrar
  outros textos parecidos, os dois trechos podem ser associados incorretamente.
- **Erro de OCR/acessibilidade:** algarismos ou vírgulas confundidos mudam
  valor, distância e classe; por exemplo, interpretar metros como quilômetros
  altera bastante o resultado. Valores ausentes, inválidos, não positivos ou
  distância total zero são rejeitados em vez de gerar classificação.
- **Estimativa simplificada:** tarifa por quilômetro não representa lucro nem
  remuneração por hora. O tempo é apenas mostrado; não participa da classe.
  Custos, trânsito, espera, retorno vazio, bônus e tarifas dinâmicas não são
  considerados.
- **Tarifa desejada:** o valor sugerido depende da tarifa informada pelo
  motorista; ela não é inferida do app nem validada contra custos reais. Uma
  configuração muito baixa ou alta produz um valor sugerido igualmente
  inadequado. O limite de entrada de R$ 1.000,00/km apenas evita valores
  absurdos por erro de digitação.
- **Eventos de janela:** a saída do app-alvo encerra o popup; certos apps ou
  telas do sistema podem não gerar eventos de acessibilidade relevantes, então
  o cartão pode permanecer até completar os dez segundos. A implementação
  também ignora eventos do Copiloto e preserva o cartão se a janela ativa ainda
  pertencer a um pacote monitorado.
- **Plataforma e permissão:** a sobreposição depende do serviço de
  acessibilidade habilitado e do Android. Não está disponível no iOS. Se o
  serviço for desativado ou desconectado, não será possível apresentar o
  popup.

## Testes

`src/screen/fareSignal.test.ts` valida a soma de distância e tempo, os três
limiares da tarifa, a conversão de metros e valores monetários e a rejeição de
distâncias sem unidade. Mudanças nas expressões de extração devem manter também
os testes de `src/screen/screenRegistry.test.ts`.
