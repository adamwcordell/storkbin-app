function ImagePreviewModal({ imageUrl, title = "Item image", onClose }) {
  if (!imageUrl) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <strong>{title}</strong>
          <button style={closeButtonStyle} onClick={onClose}>
            Close
          </button>
        </div>

        <img src={imageUrl} alt={title} style={imageStyle} />
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.65)",
  zIndex: 2000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px",
};

const modalStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "10px",
  width: "min(92vw, 900px)",
  maxHeight: "92vh",
  padding: "14px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  marginBottom: "12px",
};

const closeButtonStyle = {
  backgroundColor: "#E5E5E5",
  color: "#333333",
  border: "none",
  padding: "8px 12px",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 500,
};

const imageStyle = {
  display: "block",
  width: "100%",
  maxHeight: "78vh",
  objectFit: "contain",
  borderRadius: "8px",
  backgroundColor: "#F7F7F7",
};

export default ImagePreviewModal;
