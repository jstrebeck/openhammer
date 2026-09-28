import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest `globals`, testing-library cannot self-register cleanup.
afterEach(() => {
  cleanup();
});
