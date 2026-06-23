// Make the jest-dom matcher augmentation (toBeInTheDocument, toHaveClass, …)
// visible to tsc for component tests. The runtime import lives in test/setup.ts,
// which isn't part of the tsconfig program.
import "@testing-library/jest-dom/vitest";
