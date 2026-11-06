import type { ScheduleProblem } from "../../src/client/scheduling/model";

// Deliberately synthetic. The demo labels these as sample section times.
export const semester: ScheduleProblem = {
  title: "A week worth keeping",
  term: "Sample semester",
  source: "sample",
  groups: [
    {
      course: "COS 217",
      courseTitle: "Programming Systems",
      category: "L",
      slots: [
        [5, 540, 590],
        [5, 660, 710],
        [10, 870, 920],
      ],
    },
    {
      course: "COS 217",
      category: "P",
      slots: [
        [16, 540, 590],
        [2, 780, 830],
        [4, 960, 1010],
        [1, 840, 890],
      ],
    },
    {
      course: "COS 226",
      courseTitle: "Algorithms & Data Structures",
      category: "L",
      slots: [
        [10, 600, 650],
        [5, 810, 860],
        [10, 930, 980],
      ],
    },
    {
      course: "COS 226",
      category: "P",
      slots: [
        [16, 630, 680],
        [1, 720, 770],
        [4, 780, 830],
        [8, 840, 890],
      ],
    },
    {
      course: "MAT 202",
      courseTitle: "Linear Algebra",
      category: "L",
      slots: [
        [5, 600, 650],
        [10, 660, 710],
        [5, 870, 920],
      ],
    },
    {
      course: "MAT 202",
      category: "P",
      slots: [
        [16, 690, 740],
        [2, 720, 770],
        [4, 720, 770],
        [8, 1020, 1070],
      ],
    },
    {
      course: "ECO 100",
      courseTitle: "Microeconomics",
      category: "L",
      slots: [
        [10, 780, 830],
        [5, 930, 980],
        [10, 540, 590],
      ],
    },
    {
      course: "ECO 100",
      category: "P",
      slots: [
        [16, 780, 830],
        [1, 960, 1010],
        [8, 720, 770],
        [2, 840, 890],
      ],
    },
  ].map((g) => {
    const id = `${g.course}|${g.category}`;
    return {
      id,
      course: g.course,
      courseTitle: g.courseTitle,
      category: g.category,
      options: g.slots.map(([days, start, end], i) => ({
        id: `${id}|${i}`,
        title: `${g.category}0${i + 1}`,
        meetings: [{ days, start, end }],
        selected: i === 0,
        status: "open" as const,
        room: ["Friend Center", "McCosh", "Fine Hall", "Robertson"][
          Math.floor(i / 2) % 4
        ],
      })),
    };
  }),
};

export const impossible: ScheduleProblem = {
  title: "Three courses. Two time slots.",
  term: "Correctness example",
  source: "sample",
  groups: ["Course A", "Course B", "Course C"].map((course) => ({
    id: course,
    course,
    category: "L",
    options: [540, 600].map((start, i) => ({
      id: `${course}|${i}`,
      title: `L0${i + 1}`,
      selected: false,
      status: "open" as const,
      meetings: [{ days: 1, start, end: start + 50 }],
    })),
  })),
};
