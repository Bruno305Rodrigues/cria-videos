import express from "express";
import multer from "multer";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

const app = express();
const port = 3001;
const MAX_AUDIO_DURATION = 4 * 60; // 4 minutos em segundos

// Configuração do multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "src/uploads/"); // Diretório para armazenar os arquivos
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Função para calcular a duração total do áudio
const getAudioDuration = (audioPath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      (error, stdout) => {
        if (error) {
          return reject(error);
        }
        resolve(Number(stdout.trim()));
      }
    );
  });
};

// Função para limpar o conteúdo de uma pasta
const clearDirectory = (dirPath: string) => {
  fs.readdir(dirPath, (err, files) => {
    if (err) throw err;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      fs.rmSync(filePath, { recursive: true, force: true });
    }
  });
};

// Rota para criar vídeo
app.post("/create-video", upload.fields([{ name: "images" }, { name: "audio" }]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };

  // Log dos arquivos recebidos
  console.log("Arquivos recebidos:", files);

  const images = files.images.map((file) => path.join(__dirname, "uploads", file.filename));
  const audioPath = path.join(__dirname, "uploads", files.audio[0].filename);

  // Verifique se os arquivos existem
  if (!fs.existsSync(audioPath)) {
    console.error("Arquivo de áudio não encontrado:", audioPath);
    return res.status(400).send("Arquivo de áudio não encontrado.");
  }

  console.log("Caminhos das imagens:", images);
  console.log("Caminho do áudio:", audioPath);

  // Calcular a duração do áudio
  let audioDuration: number;
  try {
    audioDuration = await getAudioDuration(audioPath);
    console.log("Duração do áudio (segundos):", audioDuration);
    
    // Verificar se a duração do áudio excede 4 minutos
    if (audioDuration > MAX_AUDIO_DURATION) {
      console.error("O áudio excede 4 minutos.");
      return res.status(400).send("O áudio não pode ter mais de 4 minutos.");
    }
  } catch (error) {
    console.error("Erro ao obter a duração do áudio:", error);
    return res.status(500).send("Erro ao obter a duração do áudio.");
  }

  // Calcular o tempo de exibição para cada imagem
  const imageDisplayTime = audioDuration / images.length;
  console.log("Tempo de exibição por imagem (segundos):", imageDisplayTime);

  // Comando simplificado para criar o vídeo com transições
  let ffmpegCommand = `ffmpeg -y -i "${audioPath}"`;

  images.forEach((image, index) => {
    ffmpegCommand += ` -loop 1 -t ${imageDisplayTime} -i "${image}"`;
  });

  // Adicionar transições e concatenação
  let filterComplex = `"`
  for (let i = 0; i < images.length; i++) {
    filterComplex += `[${i + 1}:v]fade=t=in:st=0:d=1,fade=t=out:st=${imageDisplayTime - 1}:d=1[v${i}];`;
  }

  filterComplex += `${images.map((_, i) => `[v${i}]`).join('')}concat=n=${images.length}:v=1:a=0,format=yuv420p[v]"`;

  ffmpegCommand += ` -filter_complex ${filterComplex} -map "[v]" -map 0:a -c:v libx264 -c:a aac "src/output/output.mp4"`;

  console.log("Executando comando FFmpeg:", ffmpegCommand);

  exec(ffmpegCommand, (error) => {
    if (error) {
      console.error("Erro ao criar o vídeo:", error);
      return res.status(500).send("Erro ao criar o vídeo.");
    }

    console.log("Vídeo criado com sucesso!");
    const outputFilePath = path.join(__dirname, "output", "output.mp4");
    res.download(outputFilePath, "output.mp4", (err) => {
      if (err) {
        console.error("Erro ao enviar o arquivo:", err);
      }

      // Limpar pastas 'output' e 'uploads' após o download
      clearDirectory("src/output/");
      clearDirectory("src/uploads/");
    });
  });
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
