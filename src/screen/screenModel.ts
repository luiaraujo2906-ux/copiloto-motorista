export type ScreenElementSource = 'accessibility' | 'ocr';

export type ScreenBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ScreenElement = {
  text: string;
  bounds: ScreenBounds;
  source: ScreenElementSource;
  confidence?: number;
  className?: string;
  resourceId?: string;
  duplicateGroupId?: string;
  textConflict?: boolean;
};

export type OcrStatus = 'complete' | 'unavailable' | 'failed';

export type ScreenObservation = {
  packageName: string;
  capturedAt: number;
  screenWidth: number;
  screenHeight: number;
  accessibilityElements: ScreenElement[];
  ocrElements: ScreenElement[];
  ocrStatus: OcrStatus;
  ocrError?: string;
};

export type NormalizedScreen = Omit<
  ScreenObservation,
  'accessibilityElements' | 'ocrElements'
> & {
  coordinateSpace: 'screen-pixels';
  elements: ScreenElement[];
};

const MIN_OVERLAP_RATIO = 0.5;

function textKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function overlapRatio(first: ScreenBounds, second: ScreenBounds) {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  const intersection = width * height;
  const firstArea = Math.max(0, first.right - first.left) *
    Math.max(0, first.bottom - first.top);
  const secondArea = Math.max(0, second.right - second.left) *
    Math.max(0, second.bottom - second.top);
  const smallerArea = Math.min(firstArea, secondArea);

  return smallerArea === 0 ? 0 : intersection / smallerArea;
}

export function normalizeScreen(
  observation: ScreenObservation,
): NormalizedScreen {
  const accessibilityElements = observation.accessibilityElements.map(element => ({
    ...element,
    source: 'accessibility' as const,
  }));
  const ocrElements = observation.ocrElements.map(element => ({
    ...element,
    source: 'ocr' as const,
  }));
  const matchedOcr = new Set<number>();
  let groupNumber = 0;

  accessibilityElements.forEach(accessibilityElement => {
    const ocrIndex = ocrElements.findIndex(
      (ocrElement, index) =>
        !matchedOcr.has(index) &&
        overlapRatio(accessibilityElement.bounds, ocrElement.bounds) >=
          MIN_OVERLAP_RATIO,
    );

    if (ocrIndex === -1) {
      return;
    }

    const groupId = `duplicate-${groupNumber++}`;
    const hasTextConflict =
      textKey(accessibilityElement.text) !== textKey(ocrElements[ocrIndex].text);

    accessibilityElement.duplicateGroupId = groupId;
    accessibilityElement.textConflict = hasTextConflict;
    ocrElements[ocrIndex].duplicateGroupId = groupId;
    ocrElements[ocrIndex].textConflict = hasTextConflict;
    matchedOcr.add(ocrIndex);
  });

  return {
    ...observation,
    coordinateSpace: 'screen-pixels',
    elements: [...accessibilityElements, ...ocrElements],
  };
}
