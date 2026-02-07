import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock auth module
const mockGetAccessToken = mock(() => Promise.resolve("test-access-token"));

mock.module("./auth", () => ({
  getAccessToken: mockGetAccessToken,
}));

// Mock global fetch
const mockFetch = mock(() =>
  Promise.resolve({
    json: () =>
      Promise.resolve({
        status: 0,
        body: {
          measuregrps: [
            {
              grpid: 1,
              date: 1707000000, // 2024-02-04T...
              category: 1,
              measures: [
                { type: 1, value: 80136, unit: -3 }, // weight: 80.136 kg
                { type: 6, value: 1820, unit: -2 }, // fat%: 18.20%
                { type: 76, value: 36400, unit: -3 }, // muscle: 36.4 kg
                { type: 88, value: 3200, unit: -3 }, // bone: 3.2 kg
                { type: 77, value: 44150, unit: -3 }, // water: 44.15 kg → ~55.09%
                { type: 91, value: 2430, unit: -2 }, // bmi: 24.30
              ],
            },
          ],
        },
      }),
  })
);

// @ts-ignore - override global fetch
globalThis.fetch = mockFetch;

const { getMeasurements } = await import("./client");

beforeEach(() => {
  mockGetAccessToken.mockClear();
  mockFetch.mockClear();
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      json: () =>
        Promise.resolve({
          status: 0,
          body: {
            measuregrps: [
              {
                grpid: 1,
                date: 1707000000,
                category: 1,
                measures: [
                  { type: 1, value: 80136, unit: -3 },
                  { type: 6, value: 1820, unit: -2 },
                  { type: 76, value: 36400, unit: -3 },
                  { type: 88, value: 3200, unit: -3 },
                  { type: 77, value: 44150, unit: -3 },
                  { type: 91, value: 2430, unit: -2 },
                ],
              },
            ],
          },
        }),
    })
  );
});

describe("Withings client - getMeasurements", () => {
  test("calls Withings API with correct parameters", async () => {
    const start = new Date("2024-02-01");
    const end = new Date("2024-02-05");

    await getMeasurements(start, end);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://wbsapi.withings.net/measure");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-access-token");
  });

  test("sends correct body parameters", async () => {
    const start = new Date("2024-02-01T00:00:00Z");
    const end = new Date("2024-02-05T00:00:00Z");

    await getMeasurements(start, end);

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get("action")).toBe("getmeas");
    expect(body.get("category")).toBe("1");
    expect(body.get("meastypes")).toContain("1"); // weight
    expect(body.get("meastypes")).toContain("6"); // fat%
    expect(body.get("startdate")).toBe(
      Math.floor(start.getTime() / 1000).toString()
    );
  });

  test("parses weight correctly using value * 10^unit", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results).toHaveLength(1);
    expect(results[0].weight).toBe(80.14); // 80136 * 10^-3 = 80.136, rounded to 80.14
  });

  test("parses fat percent correctly", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results[0].fatPercent).toBe(18.2); // 1820 * 10^-2 = 18.20
  });

  test("parses muscle mass correctly", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results[0].muscleMass).toBe(36.4); // 36400 * 10^-3 = 36.4
  });

  test("parses bone mass correctly", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results[0].boneMass).toBe(3.2); // 3200 * 10^-3 = 3.2
  });

  test("converts water mass kg to percentage", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    // 44150 * 10^-3 = 44.15 kg water / 80.136 kg weight * 100 = ~55.09%
    expect(results[0].waterPercent).toBeGreaterThan(55);
    expect(results[0].waterPercent).toBeLessThan(56);
  });

  test("parses BMI correctly", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results[0].bmi).toBe(24.3); // 2430 * 10^-2 = 24.30
  });

  test("includes date and time from unix timestamp", async () => {
    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(results[0].time).toMatch(/^\d{2}:\d{2}$/);
  });

  test("filters out non-real measurements (category != 1)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            status: 0,
            body: {
              measuregrps: [
                {
                  grpid: 1,
                  date: 1707000000,
                  category: 1, // real
                  measures: [{ type: 1, value: 80000, unit: -3 }],
                },
                {
                  grpid: 2,
                  date: 1707000100,
                  category: 2, // objective/target, not real
                  measures: [{ type: 1, value: 75000, unit: -3 }],
                },
              ],
            },
          }),
      })
    );

    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results).toHaveLength(1);
    expect(results[0].weight).toBe(80);
  });

  test("skips groups without weight measurement", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            status: 0,
            body: {
              measuregrps: [
                {
                  grpid: 1,
                  date: 1707000000,
                  category: 1,
                  measures: [{ type: 6, value: 1820, unit: -2 }], // only fat%, no weight
                },
              ],
            },
          }),
      })
    );

    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-05")
    );

    expect(results).toHaveLength(0);
  });

  test("throws on API error status", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            status: 401,
            error: "Invalid token",
          }),
      })
    );

    expect(
      getMeasurements(new Date("2024-02-01"), new Date("2024-02-05"))
    ).rejects.toThrow("Withings API error");
  });

  test("sorts results by date descending", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            status: 0,
            body: {
              measuregrps: [
                {
                  grpid: 1,
                  date: 1707000000, // earlier
                  category: 1,
                  measures: [{ type: 1, value: 80000, unit: -3 }],
                },
                {
                  grpid: 2,
                  date: 1707100000, // later
                  category: 1,
                  measures: [{ type: 1, value: 79500, unit: -3 }],
                },
              ],
            },
          }),
      })
    );

    const results = await getMeasurements(
      new Date("2024-02-01"),
      new Date("2024-02-10")
    );

    expect(results).toHaveLength(2);
    // Most recent first
    expect(results[0].weight).toBe(79.5);
    expect(results[1].weight).toBe(80);
  });
});
