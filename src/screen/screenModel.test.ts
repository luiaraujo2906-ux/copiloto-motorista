import {normalizeScreen, ScreenElement, ScreenObservation} from './screenModel';

const element = (
  text: string,
  source: ScreenElement['source'],
  bounds = {left: 10, top: 20, right: 110, bottom: 60},
): ScreenElement => ({text, source, bounds});

const observation = (
  accessibilityElements: ScreenElement[],
  ocrElements: ScreenElement[],
): ScreenObservation => ({
  packageName: 'com.example.driver',
  capturedAt: 123,
  screenWidth: 1080,
  screenHeight: 2400,
  accessibilityElements,
  ocrElements,
  ocrStatus: 'complete',
});

describe('normalizeScreen', () => {
  it('preserves both sources and marks matching text as a duplicate', () => {
    const screen = normalizeScreen(
      observation(
        [element('Aceitar corrida', 'accessibility')],
        [element('Aceitar corrida', 'ocr')],
      ),
    );

    expect(screen.coordinateSpace).toBe('screen-pixels');
    expect(screen.elements).toHaveLength(2);
    expect(screen.elements.map(item => item.source)).toEqual([
      'accessibility',
      'ocr',
    ]);
    expect(screen.elements[0].duplicateGroupId).toBe(
      screen.elements[1].duplicateGroupId,
    );
    expect(screen.elements[0].textConflict).toBe(false);
  });

  it('retains and marks differing observations of the same screen area', () => {
    const screen = normalizeScreen(
      observation(
        [element('R$ 18,00', 'accessibility')],
        [element('R$ 16,00', 'ocr')],
      ),
    );

    expect(screen.elements.map(item => item.text)).toEqual([
      'R$ 18,00',
      'R$ 16,00',
    ]);
    expect(screen.elements.every(item => item.textConflict)).toBe(true);
    expect(screen.elements[0].duplicateGroupId).toBe(
      screen.elements[1].duplicateGroupId,
    );
  });

  it('does not group elements with unrelated bounds', () => {
    const screen = normalizeScreen(
      observation(
        [element('Origem', 'accessibility')],
        [
          element('Destino', 'ocr', {
            left: 500,
            top: 800,
            right: 600,
            bottom: 840,
          }),
        ],
      ),
    );

    expect(screen.elements).toHaveLength(2);
    expect(screen.elements.every(item => item.duplicateGroupId === undefined))
      .toBe(true);
  });

  it('keeps OCR failure details and optional metadata', () => {
    const screen = normalizeScreen({
      ...observation([], [element('Texto', 'ocr')]),
      ocrStatus: 'failed',
      ocrError: 'Screenshot permission denied',
    });

    expect(screen.ocrError).toBe('Screenshot permission denied');
    expect(screen.elements[0].className).toBeUndefined();
    expect(screen.elements[0].confidence).toBeUndefined();
  });
});
