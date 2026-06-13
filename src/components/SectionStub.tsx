export function SectionStub({
  title,
  stage,
  description,
}: {
  title: string;
  stage: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          {stage}
        </span>
        <p className="mt-2 max-w-xl text-sm text-gray-600">{description}</p>
      </div>
    </div>
  );
}
