import {NormalizedScreen, ScreenElement} from './screenModel';

export type ScreenDetection = {
  id: string;
  name: string;
  providerId: string;
  extractedData: Record<string, string[]>;
};

type ScreenKeywordRule = {
  text: string;
};

type ScreenValueRule = {
  field: string;
  pattern: RegExp;
  compact?: boolean;
  occurrence?: number;
};

type ScreenDefinition = {
  id: string;
  name: string;
  providerId: string;
  keywords: ScreenKeywordRule[];
  identifyBy: string[];
  values: ScreenValueRule[];
};

const screenDefinitions: ScreenDefinition[] = [
  {
    id: 'ride-completion',
    name: 'Encerramento da corrida',
    providerId: 'ride-completion',
    keywords: [
      {
        text: 'Cobrar do passageiro',
      },
      {
        text: 'O passageiro pagou',
      },
      {
        text: 'Tive problemas para receber',
      },
    ],
    identifyBy: [],
    values: [
      {
        field: 'rideValue',
        pattern: /R\$\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/i,
        compact: true,
      },
    ],
  },
  {
    id: 'ride-offer',
    name: 'Oferta de corrida',
    providerId: 'ride-offer',
    keywords: [],
    identifyBy: [
      'category',
      'rideValue',
      'pickupTimeDistance',
      'destinationTimeDistance',
    ],
    values: [
      {
        field: 'category',
        pattern: /\b(?:Moto|Carro)\b/i,
      },
      {
        field: 'rideValue',
        pattern: /R\$\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/i,
        compact: true,
      },
      {
        field: 'pickupTimeDistance',
        pattern: /\d+\s*min\s*\(\s*\d+(?:[.,]\d+)?\s*(?:km|m)?\s*\)/i,
      },
      {
        field: 'destinationTimeDistance',
        pattern: /\d+\s*min\s*\(\s*\d+(?:[.,]\d+)?\s*(?:km|m)?\s*\)/i,
        occurrence: 1,
      },
    ],
  },
];

function normalizeText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function findKeywordElement(elements: ScreenElement[], rule: ScreenKeywordRule) {
  const keyword = normalizeText(rule.text);
  return elements.find(
    element => normalizeText(element.text).includes(keyword),
  );
}

function findValues(elements: ScreenElement[], rule: ScreenValueRule) {
  const orderedElements = [
    ...elements.filter(element => element.source === 'ocr'),
    ...elements.filter(element => element.source === 'accessibility'),
  ];
  const seenDuplicateGroups = new Set<string>();
  const values: string[] = [];

  for (const element of orderedElements) {
    if (
      element.duplicateGroupId &&
      seenDuplicateGroups.has(element.duplicateGroupId)
    ) {
      continue;
    }
    if (element.duplicateGroupId) {
      seenDuplicateGroups.add(element.duplicateGroupId);
    }

    const match = rule.pattern.exec(element.text);
    if (match && !values.includes(match[0])) {
      values.push(match[0]);
    }
  }

  return values.map(value =>
    rule.compact ? value.replace(/\s+/g, '') : value.replace(/\s+/g, ' ').trim(),
  );
}

export function identifyScreen(screen: NormalizedScreen): ScreenDetection | null {
  for (const definition of screenDefinitions) {
    const matches = definition.keywords.map(rule => ({
      rule,
      element: findKeywordElement(screen.elements, rule),
    }));

    if (matches.some(match => match.element === undefined)) {
      continue;
    }

    const extractedData: Record<string, string[]> = {};
    for (const rule of definition.values) {
      const value = findValues(screen.elements, rule)[rule.occurrence ?? 0];
      if (value !== undefined) {
        extractedData[rule.field] = [value];
      }
    }
    if (definition.identifyBy.some(field => extractedData[field] === undefined)) {
      continue;
    }

    return {
      id: definition.id,
      name: definition.name,
      providerId: definition.providerId,
      extractedData,
    };
  }

  return null;
}
