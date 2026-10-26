export type FareSignal = {
  fare: number;
  totalDistanceKm: number;
  totalMinutes: number;
  ratePerKm: number;
  classification: 'ruim' | 'média' | 'boa';
  backgroundColor: string;
  fareLabel: string;
  distanceLabel: string;
  timeLabel: string;
  rateLabel: string;
  suggestedFareLabel: string;
};

export const DEFAULT_DRIVER_RATE_PER_KM = 1.5;

function parseBrazilianNumber(value: string) {
  const normalized = value.includes(',')
    ? value.replace(/\./g, '').replace(',', '.')
    : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFare(value: string) {
  const match = /R\$\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/i.exec(value);
  return match ? parseBrazilianNumber(match[1]) : null;
}

function parseTimeAndDistance(value: string) {
  const match =
    /(\d+)\s*min\s*\(\s*(\d+(?:[.,]\d+)?)\s*(km|m)\s*\)/i.exec(value);
  if (!match) {
    return null;
  }

  const distance = parseBrazilianNumber(match[2]);
  if (distance === null || distance <= 0) {
    return null;
  }

  return {
    minutes: Number(match[1]),
    distanceKm: match[3].toLocaleLowerCase() === 'm' ? distance / 1000 : distance,
  };
}

function formatNumber(value: number) {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function calculateFareSignal(
  extractedData: Record<string, string[]>,
  driverRatePerKm = DEFAULT_DRIVER_RATE_PER_KM,
): FareSignal | null {
  const fareValue = extractedData.rideValue?.[0];
  const pickupValue = extractedData.pickupTimeDistance?.[0];
  const destinationValue = extractedData.destinationTimeDistance?.[0];
  if (!fareValue || !pickupValue || !destinationValue) {
    return null;
  }
  if (!Number.isFinite(driverRatePerKm) || driverRatePerKm <= 0) {
    return null;
  }

  const fare = parseFare(fareValue);
  const pickup = parseTimeAndDistance(pickupValue);
  const destination = parseTimeAndDistance(destinationValue);
  if (fare === null || fare <= 0 || !pickup || !destination) {
    return null;
  }

  const totalDistanceKm = pickup.distanceKm + destination.distanceKm;
  if (!Number.isFinite(totalDistanceKm) || totalDistanceKm <= 0) {
    return null;
  }

  const ratePerKm = fare / totalDistanceKm;
  const classification =
    ratePerKm < 1.3 ? 'ruim' : ratePerKm < 1.5 ? 'média' : 'boa';
  const backgroundColor =
    classification === 'ruim'
      ? '#C62828'
      : classification === 'média'
        ? '#F9A825'
        : '#2E7D32';

  return {
    fare,
    totalDistanceKm,
    totalMinutes: pickup.minutes + destination.minutes,
    ratePerKm,
    classification,
    backgroundColor,
    fareLabel: `R$ ${formatNumber(fare)}`,
    distanceLabel: `${formatNumber(totalDistanceKm)} km`,
    timeLabel: `${pickup.minutes + destination.minutes} min`,
    rateLabel: `R$ ${formatNumber(ratePerKm)}/km`,
    suggestedFareLabel: `R$ ${formatNumber(totalDistanceKm * driverRatePerKm)}`,
  };
}
