// A queue that starts each run after every earlier run has settled. A rejection reaches its own caller only.
export const serialize = () => {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(run: () => Promise<T>): Promise<T> => {
        const result = tail.then(run);
        tail = result.catch(() => undefined);
        return result;
    };
};
