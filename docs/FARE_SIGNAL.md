# Farol de valores

O farol de valores estima a tarifa bruta por quilômetro de uma oferta de
corrida. Quando a tela identificada como `ride-offer` contém os dados
necessários, o painel do Copiloto exibe um cartão colorido com valor da corrida,
distância total, tempo total, tarifa por quilômetro e classificação, além do
valor sugerido com base na tarifa configurada. O cartão aparece somente dentro
do app; nenhuma janela é desenhada sobre o aplicativo de corrida.

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
   `calculateFareSignal` em `src/screen/fareSignal.ts` e mantém o resultado no
   estado da interface. Quando a tela deixa de ser uma oferta calculável, o
   cartão é removido do painel. A tarifa desejada pode ser alterada na seção
   **Tarifa por quilômetro** e é salva pelo módulo nativo nas preferências
   privadas do app.

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
| Debounce da análise | `AccessibilityScreenService.kt`, `SCREEN_SETTLE_DELAY_MILLIS` | `800L` | Espera após eventos da tela antes de coletar textos e executar OCR. Aumentar pode evitar leitura de telas ainda renderizando, mas atrasa o farol. |
| Limite de nós de acessibilidade | `AccessibilityScreenService.kt`, `maxNodes` | `500` | Limita a quantidade de nós visitados por análise. |
| Limites de classificação | `src/screen/fareSignal.ts`, classificação em `calculateFareSignal` | `1.3` e `1.5` R$/km | Altera as fronteiras entre ruim, média e boa. Atualize também os testes em `fareSignal.test.ts`. |
| Tarifa desejada pelo motorista | App: seção **Tarifa por quilômetro**; persistência em `ScreenMonitorModule.kt` | `1,50` R$/km | Determina o valor sugerido (`distância total * tarifa desejada`). Aceita valores maiores que zero até R$ 1.000,00/km; fica salva nas preferências privadas do Android. |
| Cores | `src/screen/fareSignal.ts`, `backgroundColor` | vermelho `#C62828`, amarelo `#F9A825`, verde `#2E7D32` | Cor retornada pelo cálculo e aplicada ao cartão no app. |
| Formatos de extração | `src/screen/screenRegistry.ts`, definição `ride-offer` | moeda `R$`, tempo `min`, distância `m`/`km` | Determina quais textos formam uma oferta e quais dois trechos são usados. |
| Apps monitorados | `TargetAppPackages.kt` | lista de pacotes configurada no código | Pacotes fora da lista não são analisados. |

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
- **Exibição:** o cartão é parte da interface do Copiloto e não fica visível
  sobre outros apps. Abra o Copiloto para consultar o resultado reconhecido.
- **Plataforma:** a captura e o cálculo dependem do serviço de acessibilidade
  habilitado e do Android. O farol não está disponível no iOS.

## Testes

`src/screen/fareSignal.test.ts` valida a soma de distância e tempo, os três
limiares da tarifa, a conversão de metros e valores monetários e a rejeição de
distâncias sem unidade. Mudanças nas expressões de extração devem manter também
os testes de `src/screen/screenRegistry.test.ts`.
