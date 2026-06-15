const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const dataFile = path.join(__dirname, 'data.json');

// 初始化数据结构
let appData = {
  prayer: { subs: ['晨祷', '晚祷'], contents: { '晨祷': [], '晚祷': [] } },
  song: { subs: ['赞美诗', '敬拜歌'], contents: { '赞美诗': [], '敬拜歌': [] } },
  bible: { subs: ['旧约', '新约'], contents: { '旧约': [], '新约': [] } },
  about: { subs: ['教会介绍', '信仰告白'], contents: { '教会介绍': [], '信仰告白': [] } }
};

if (fs.existsSync(dataFile)) {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile));
    for (let cat of ['prayer', 'song', 'bible', 'about']) {
      if (saved[cat]) {
        if (!saved[cat].subs) saved[cat].subs = appData[cat].subs;
        if (!saved[cat].contents) saved[cat].contents = appData[cat].contents;
        // 兼容旧数据：确保每个内容项都有 html 字段
        for (let sub in saved[cat].contents) {
          if (Array.isArray(saved[cat].contents[sub])) {
            saved[cat].contents[sub] = saved[cat].contents[sub].map(item => {
              if (!item.html) item.html = '<p>（内容暂无）</p>';
              return item;
            });
          }
        }
        appData[cat] = saved[cat];
      }
    }
  } catch(e) { console.error('读取数据失败', e); }
}

function saveData() {
  fs.writeFileSync(dataFile, JSON.stringify(appData, null, 2));
}

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error('只允许图片或音频文件'), false);
  }
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(uploadDir));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.send(200);
  next();
});

// ========== API ==========
// 获取子分类
app.get('/api/subcategories', (req, res) => {
  const parent = req.query.parent;
  if (!parent || !appData[parent]) return res.status(400).json({ error: '无效主分类' });
  res.json({ subs: appData[parent].subs });
});

// 添加子分类
app.post('/api/subcategories', (req, res) => {
  const { parent, subName } = req.body;
  if (!parent || !subName || !appData[parent]) return res.status(400).json({ error: '参数错误' });
  if (appData[parent].subs.includes(subName)) return res.status(409).json({ error: '子分类已存在' });
  appData[parent].subs.push(subName);
  appData[parent].contents[subName] = [];
  saveData();
  res.json({ success: true, subs: appData[parent].subs });
});

// 删除子分类
app.delete('/api/subcategories', (req, res) => {
  const { parent, subName } = req.body;
  if (!parent || !subName || !appData[parent]) return res.status(400).json({ error: '参数错误' });
  const idx = appData[parent].subs.indexOf(subName);
  if (idx === -1) return res.status(404).json({ error: '子分类不存在' });
  const contents = appData[parent].contents[subName] || [];
  for (let item of contents) {
    if (item.html) {
      const urls = item.html.match(/\/uploads\/[^\s"']+/g) || [];
      urls.forEach(url => {
        const filePath = path.join(uploadDir, path.basename(url));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }
  }
  delete appData[parent].contents[subName];
  appData[parent].subs.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

// 获取内容列表（安全生成摘要）
app.get('/api/contents', (req, res) => {
  const { parent, sub } = req.query;
  if (!parent || !sub || !appData[parent]) return res.status(400).json({ error: '参数错误' });
  const contents = appData[parent].contents[sub] || [];
  const listContents = contents.map(item => {
    const htmlContent = item.html || '<p>（内容暂无）</p>';
    let plainText = htmlContent.replace(/<[^>]*>/g, '');
    const summary = plainText.length > 100 ? plainText.slice(0, 100) + '…' : plainText;
    return {
      id: item.id,
      title: item.title || '无标题',
      html: htmlContent,
      summary: summary
    };
  });
  res.json({ contents: listContents });
});

// 获取单条内容详情
app.get('/api/content/:id', (req, res) => {
  const id = parseInt(req.params.id);
  for (let parent of ['prayer', 'song', 'bible', 'about']) {
    for (let sub of appData[parent].subs) {
      const arr = appData[parent].contents[sub];
      if (arr) {
        const item = arr.find(i => i.id === id);
        if (item) return res.json(item);
      }
    }
  }
  res.status(404).json({ error: '内容不存在' });
});

// 添加内容（富文本）
app.post('/api/contents', upload.any(), (req, res) => {
  const { parent, sub, title, html } = req.body;
  if (!parent || !sub || !title || !html) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  if (!appData[parent] || !appData[parent].subs.includes(sub)) {
    return res.status(400).json({ error: '子分类不存在' });
  }
  if (!appData[parent].contents[sub]) appData[parent].contents[sub] = [];

  const newItem = {
    id: Date.now(),
    title: title.trim(),
    html: html,
    createdAt: new Date().toISOString()
  };
  appData[parent].contents[sub].unshift(newItem);
  saveData();
  res.status(201).json({ success: true, item: newItem });
});

// 删除内容
app.delete('/api/contents/:id', (req, res) => {
  const id = parseInt(req.params.id);
  let found = false;
  for (let parent of ['prayer', 'song', 'bible', 'about']) {
    for (let sub of appData[parent].subs) {
      const arr = appData[parent].contents[sub];
      if (arr) {
        const index = arr.findIndex(item => item.id === id);
        if (index !== -1) {
          const item = arr[index];
          if (item.html) {
            const urls = item.html.match(/\/uploads\/[^\s"']+/g) || [];
            urls.forEach(url => {
              const filePath = path.join(uploadDir, path.basename(url));
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
          }
          arr.splice(index, 1);
          found = true;
          break;
        }
      }
    }
    if (found) break;
  }
  if (!found) return res.status(404).json({ error: '内容不存在' });
  saveData();
  res.json({ success: true });
});

// 单独文件上传（供富文本编辑器使用）
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// ========== 全局搜索接口 ==========
app.get('/api/search', (req, res) => {
  const keyword = req.query.q;
  if (!keyword || keyword.trim() === '') {
    return res.json({ results: [] });
  }
  const lowerKeyword = keyword.toLowerCase();
  const results = [];

  for (let parent of ['prayer', 'song', 'bible', 'about']) {
    for (let sub of appData[parent].subs) {
      const contents = appData[parent].contents[sub] || [];
      for (let item of contents) {
        const title = (item.title || '').toLowerCase();
        const htmlContent = item.html || '';
        const plainText = htmlContent.replace(/<[^>]*>/g, '').toLowerCase();
        if (title.includes(lowerKeyword) || plainText.includes(lowerKeyword)) {
          results.push({
            id: item.id,
            title: item.title,
            parentCategory: parent,
            subCategory: sub,
            summary: (plainText.length > 100 ? plainText.slice(0, 100) + '…' : plainText)
          });
        }
      }
    }
  }
  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`✅ 后端服务运行在 http://localhost:${PORT}`);
  console.log(`📱 前台: http://localhost:3000`);
  console.log(`🔧 后台: http://localhost:3000/admin.html`);
});