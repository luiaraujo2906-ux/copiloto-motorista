import {calculateFareSignal} from './fareSignal';

describe('calculateFareSignal', () => {
  const createOffer = (fare: string) => ({
    rideValue: [fare],
    pickupTimeDistance: ['7 min (867 m)'],
    destinationTimeDistance: ['5 min (1,6 km)'],
  });

  it('calculates combined distance and time, and classifies the fare per km', () => {
    expect(calculateFareSignal(createOffer('R$4,20'))).toMatchObject({
      fare: 4.2,
      totalDistanceKm: 2.467,
      totalMinutes: 12,
      ratePerKm: expect.closeTo(4.2 / 2.467),
      classification: 'boa',
      backgroundColor: '#2E7D32',
      fareLabel: 'R$ 4,20',
      distanceLabel: '2,47 km',
      timeLabel: '12 min',
      suggestedFareLabel: 'R$ 3,70',
    });
  });

  it('calculates the suggested fare using the configured driver rate', () => {
    expect(
      calculateFareSignal(createOffer('R$4,20'), 2.25)?.suggestedFareLabel,
    ).toBe('R$ 5,55');
    expect(calculateFareSignal(createOffer('R$4,20'), 0)).toBeNull();
  });

  it.each([
    ['R$3,24', 'ruim', '#C62828'],
    ['R$3,25', 'média', '#F9A825'],
    ['R$3,74', 'média', '#F9A825'],
    ['R$3,75', 'boa', '#2E7D32'],
  ])('classifies %s as %s', (fare, classification, backgroundColor) => {
    const offer = {
      rideValue: [fare],
      pickupTimeDistance: ['7 min (1 km)'],
      destinationTimeDistance: ['5 min (1,5 km)'],
    };
    expect(calculateFareSignal(offer)).toMatchObject({
      classification,
      backgroundColor,
    });
  });

  it('supports thousands separators and rejects missing or invalid units', () => {
    expect(
      calculateFareSignal({
        ...createOffer('R$ 1.234,56'),
        pickupTimeDistance: ['7 min (867)'],
      }),
    ).toBeNull();
    expect(
      calculateFareSignal({
        ...createOffer('R$ 1.234,56'),
        pickupTimeDistance: ['7 min (867 m)'],
      })?.fare,
    ).toBe(1234.56);
  });

  it('accepts decimal points in recognized distances', () => {
    expect(
      calculateFareSignal({
        ...createOffer('R$4,20'),
        pickupTimeDistance: ['7 min (0.867 km)'],
        destinationTimeDistance: ['5 min (1.6 km)'],
      })?.totalDistanceKm,
    ).toBe(2.467);
  });
});
