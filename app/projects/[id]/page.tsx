interface Props {
  params: { id: string }
}

export default function ProjectDetailPage({ params }: Props) {
  return <div data-id={params.id} />
}
