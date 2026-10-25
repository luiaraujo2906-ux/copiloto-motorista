import {normalizeScreen, ScreenElement} from './screenModel';
import {identifyScreen} from './screenRegistry';

const expectedElements: ScreenElement[] = [
  {
    text: 'Cobrar do passageiro',
    source: 'ocr',
    bounds: {left: 251, top: 406, right: 832, bottom: 557},
  },
  {
    text: 'R$ 9,40',
    source: 'ocr',
    bounds: {left: 800, top: 628, right: 968, bottom: 657},
  },
  {
    text: 'O passageiro pagou',
    source: 'accessibility',
    bounds: {left: 344, top: 1958, right: 770, bottom: 2014},
  },
  {
    text: 'Tive problemas para receber',
    source: 'ocr',
    bounds: {left: 207, top: 2149, right: 872, bottom: 2198},
  },
];

function createScreen(elements: ScreenElement[]) {
  return normalizeScreen({
    packageName: 'com.app99.driver',
    capturedAt: 123,
    screenWidth: 1080,
    screenHeight: 2340,
    accessibilityElements: elements.filter(
      element => element.source === 'accessibility',
    ),
    ocrElements: elements.filter(element => element.source === 'ocr'),
    ocrStatus: 'complete',
  });
}

const offerElements: ScreenElement[] = [
  {
    text: 'Moto',
    source: 'ocr',
    bounds: {left: 96, top: 919, right: 206, bottom: 961},
  },
  {
    text: 'R$4,20',
    source: 'ocr',
    bounds: {left: 79, top: 1046, right: 473, bottom: 1162},
  },
  {
    text: '7 min (867 m)',
    source: 'ocr',
    bounds: {left: 140, top: 1653, right: 453, bottom: 1703},
  },
  {
    text: '5 min (1,6 km)',
    source: 'ocr',
    bounds: {left: 143, top: 1856, right: 456, bottom: 1904},
  },
];

describe('identifyScreen', () => {
  it('uses labels for identification and extracts only predefined values', () => {
    expect(identifyScreen(createScreen(expectedElements))).toEqual({
      id: 'ride-completion',
      name: 'Encerramento da corrida',
      providerId: 'ride-completion',
      extractedData: {
        rideValue: ['R$9,40'],
      },
    });
  });

  it('extracts a variable-width monetary value regardless of its position', () => {
    const screen = createScreen([
      ...expectedElements.filter(element => element.text !== 'R$ 9,40'),
      {
        text: 'R$ 1.234,56',
        source: 'ocr',
        bounds: {left: 790, top: 628, right: 978, bottom: 657},
      },
      {
        text: 'R$ 8,60',
        source: 'ocr',
        bounds: {left: 600, top: 620, right: 700, bottom: 650},
      },
    ]);

    expect(identifyScreen(screen)?.extractedData.rideValue).toEqual([
      'R$1.234,56',
    ]);
  });

  it('keeps the identified screen when the fare value is not recognized', () => {
    const screen = createScreen(
      expectedElements.filter(element => element.text !== 'R$ 9,40'),
    );

    expect(identifyScreen(screen)?.id).toBe('ride-completion');
    expect(identifyScreen(screen)?.extractedData.rideValue).toBeUndefined();
  });

  it('normalizes case and accents without depending on screen coordinates', () => {
    const changedLayoutElements = expectedElements.map(element => ({
      ...element,
      text: element.text.toUpperCase(),
      bounds: {
        left: 0,
        top: 0,
        right: 100,
        bottom: 50,
      },
    }));

    expect(
      identifyScreen(
        normalizeScreen({
          packageName: 'com.app99.driver',
          capturedAt: 123,
          screenWidth: 540,
          screenHeight: 1170,
          accessibilityElements: [],
          ocrElements: changedLayoutElements,
          ocrStatus: 'complete',
        }),
      )?.id,
    ).toBe('ride-completion');
  });

  it('does not identify a partial screen but ignores keyword positions', () => {
    expect(identifyScreen(createScreen(expectedElements.slice(0, 2)))).toBeNull();
    const relocatedScreen = identifyScreen(
      createScreen(
        expectedElements.map(element => ({
          ...element,
          bounds: {left: 0, top: 0, right: 100, bottom: 50},
        })),
      ),
    );
    expect(relocatedScreen?.id).toBe('ride-completion');
  });

  it('identifies an offer and extracts only its predefined values', () => {
    expect(identifyScreen(createScreen(offerElements))).toEqual({
      id: 'ride-offer',
      name: 'Oferta de corrida',
      providerId: 'ride-offer',
      extractedData: {
        category: ['Moto'],
        rideValue: ['R$4,20'],
        pickupTimeDistance: ['7 min (867 m)'],
        destinationTimeDistance: ['5 min (1,6 km)'],
      },
    });
  });

  it('accepts Carro and variable-width values regardless of their positions', () => {
    const screen = createScreen([
      {...offerElements[0], text: 'Carro'},
      {
        ...offerElements[1],
        text: 'R$1.234,56',
        bounds: {left: 50, top: 1050, right: 510, bottom: 1155},
      },
      offerElements[2],
      offerElements[3],
      {
        text: 'R$99,99',
        source: 'ocr',
        bounds: {left: 600, top: 1046, right: 750, bottom: 1162},
      },
    ]);

    expect(identifyScreen(screen)?.extractedData).toEqual({
      category: ['Carro'],
      rideValue: ['R$1.234,56'],
      pickupTimeDistance: ['7 min (867 m)'],
      destinationTimeDistance: ['5 min (1,6 km)'],
    });
  });

  it('does not identify an offer without its pickup and destination markers', () => {
    expect(
      identifyScreen(createScreen(offerElements.slice(0, 2))),
    ).toBeNull();
  });
});
