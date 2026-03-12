export default function LandingPage() {
  return (
    <main style={styles.main}>
      
      {/* CTA CENTRAL 
      <a href="/provider" style={styles.ctaWrapper}>
        <svg
          width="220"
          height="80"
          viewBox="0 0 220 80"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="1"
            y="1"
            width="218"
            height="78"
            fill="none"
            stroke="black"
            strokeWidth="2"
          />
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontFamily="sans-serif"
            fontSize="22"
            fill="black"
          >
            Acesse
          </text>
        </svg>
      </a> */}

      {/* ASSINATURA */}
      <a
        href="https://www.treine.com.gt"
        target="_blank"
        rel="noopener noreferrer"
        style={styles.signatureWrapper}
      >
        <img
          src="/treinecomgt.svg"
          alt="treine.com.gt"
          style={styles.signature}
        />
      </a>

    </main>
  )
}

const styles = {
  main: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    position: "relative"
  },
  ctaWrapper: {
    textDecoration: "none",
    cursor: "pointer"
  },
  signatureWrapper: {
    position: "absolute",
    bottom: "24px",
    right: "24px",
    width: "180px",
    opacity: 0.8
  },
  signature: {
    width: "100%",
    height: "auto",
    display: "block"
  }
}
