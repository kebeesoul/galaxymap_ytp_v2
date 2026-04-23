interface Props {
  params: { id: string }
}

export default function EditorPage({ params }: Props) {
  return <div data-id={params.id} />
}
