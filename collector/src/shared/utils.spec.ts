import { withRetry } from './utils';

describe('withRetry', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('returns the result on first successful attempt', async () => {
        const fn = jest.fn().mockResolvedValue('success');
        const promise = withRetry(fn, { retries: 3, delay: 1000 });
        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and returns result when subsequent attempt succeeds', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockResolvedValue('success');

        const promise = withRetry(fn, { retries: 3, delay: 1000 });
        // First attempt fails, delay = 1000 * 2^0 = 1000ms
        await jest.advanceTimersByTimeAsync(1000);
        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('applies exponential backoff between retries', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('success');

        const promise = withRetry(fn, { retries: 3, delay: 1000 });
        // After first failure: delay = 1000 * 2^0 = 1000ms
        await jest.advanceTimersByTimeAsync(1000);
        // After second failure: delay = 1000 * 2^1 = 2000ms
        await jest.advanceTimersByTimeAsync(2000);
        const result = await promise;
        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws the last error when all retries are exhausted', async () => {
        jest.useRealTimers();
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockRejectedValueOnce(new Error('fail 3'));

        await expect(withRetry(fn, { retries: 3, delay: 1 })).rejects.toThrow('fail 3');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('uses default options when none provided', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValue('ok');

        const promise = withRetry(fn);
        // Default delay=1000, 2^0 = 1000ms
        await jest.advanceTimersByTimeAsync(1000);
        const result = await promise;
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry when retries is 1', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('single fail'));
        await expect(withRetry(fn, { retries: 1, delay: 1000 })).rejects.toThrow('single fail');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
