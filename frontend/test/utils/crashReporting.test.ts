import { reportError, setErrorReporter } from '@/utils/crashReporting';

describe('crashReporting', () => {
  it('forwards errors and context to the configured reporter', () => {
    const spy = jest.fn();
    setErrorReporter(spy);
    const err = new Error('boom');
    reportError(err, { source: 'test' });
    expect(spy).toHaveBeenCalledWith(err, { source: 'test' });
  });
  it('wraps non-Error values', () => {
    const spy = jest.fn();
    setErrorReporter(spy);
    reportError('oops');
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(spy.mock.calls[0][0].message).toBe('oops');
  });
  it('never throws if the reporter does', () => {
    setErrorReporter(() => { throw new Error('reporter down'); });
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
});
