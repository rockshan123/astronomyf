import { createFileRoute } from "@tanstack/react-router";
import { ClassroomApp } from "@/components/classroom/ClassroomApp";

export const Route = createFileRoute("/classroom")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Astronomy Classroom — Tashrihul Aflak 3D" },
      { name: "description", content: "A 3D astronomy teaching whiteboard with ten great circles, drawing and measuring tools." },
    ],
  }),
  component: ClassroomApp,
});
