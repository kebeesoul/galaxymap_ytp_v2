interface Comment {
  username: string
  body: string
  likes_count: number
}

interface Props {
  comments: Comment[]
}

export default function CommentLayer({ comments }: Props) {
  const visible = comments.slice(0, 3)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '8%',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '0 48px',
      }}
    >
      {visible.map((c, i) => (
        <div
          key={i}
          style={{
            backgroundColor: 'rgba(0,0,0,0.80)',
            borderRadius: 12,
            padding: '12px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ color: '#ffffff', fontSize: 22, fontWeight: 600 }}>{c.username}</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18 }}>👍 {c.likes_count}</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 22, margin: 0, lineHeight: 1.4 }}>
            {c.body}
          </p>
        </div>
      ))}
    </div>
  )
}
