import { FredObservationResponse } from '../types';

export const fredSuccessFixture: FredObservationResponse = {
  observations: [
    {
      date: '2026-03-01',
      value: '312.332',
      realtime_start: '2026-04-10',
      realtime_end: '2026-04-10',
    },
  ],
};

export const fredMissingValueFixture: FredObservationResponse = {
  observations: [
    {
      date: '2026-03-02',
      value: '.',
      realtime_start: '2026-04-10',
      realtime_end: '2026-04-10',
    },
  ],
};

export const fredStaleFixture: FredObservationResponse = {
  observations: [
    {
      date: '2025-12-01',
      value: '99.1',
      realtime_start: '2025-12-02',
      realtime_end: '2025-12-02',
    },
  ],
};

export const fredFailureFixture: FredObservationResponse = {
  error_code: 400,
  error_message: 'Bad Request. The series does not exist.',
};
