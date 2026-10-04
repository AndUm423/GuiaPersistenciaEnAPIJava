CREATE TABLE IF NOT EXISTS saludos (
    id         BIGSERIAL    PRIMARY KEY,
    nombre     VARCHAR(50)  NOT NULL,
    color      VARCHAR(7)   NOT NULL,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);