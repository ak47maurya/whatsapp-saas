import path from 'path';
import Contact from '../models/Contact.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import { parseCSV } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import fs from 'fs/promises';
import xlsx from 'xlsx';

export const index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { search, tag, isBlocked } = req.query;

    const filter = { user: req.userId, isDeleted: false };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (tag) filter.tags = { $in: [tag] };
    if (isBlocked !== undefined) filter.isBlocked = isBlocked === 'true';

    const [contacts, total] = await Promise.all([
      Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Contact.countDocuments(filter),
    ]);

    const allTags = await Contact.distinct('tags', { user: req.userId });

    if (req.xhr || req.headers.accept?.includes('json')) {
      return paginatedResponse(res, contacts, total, page, limit);
    }

    res.render('contact/index', {
      title: 'Contacts',
      contacts,
      allTags,
      total,
      page,
      limit,
      filters: { search, tag, isBlocked },
      activePage: 'contacts',
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const create = async (req, res) => {
  try {
    const { name, phone, email, tags, notes } = req.body;
    const contact = await Contact.create({
      user: req.userId,
      name,
      phone,
      email,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
      notes,
    });
    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { contact }, 'Contact created', 201);
    }
    req.session.success = 'Contact created successfully';
    res.redirect('/contacts');
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 400);
    }
    req.session.error = error.message;
    res.redirect('/contacts');
  }
};

export const update = async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!contact) return errorResponse(res, 'Contact not found', 404);
    successResponse(res, { contact }, 'Contact updated');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};

export const show = async (req, res) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, user: req.userId });
    if (!contact) return errorResponse(res, 'Contact not found', 404);
    successResponse(res, { contact });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const remove = async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { isDeleted: true },
      { new: true }
    );
    if (!contact) return errorResponse(res, 'Contact not found', 404);
    successResponse(res, null, 'Contact deleted');
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const importContacts = async (req, res) => {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    let contacts = [];

    if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
      const content = await fs.readFile(req.file.path, 'utf-8');
      contacts = parseCSV(content);
    } else if (req.file.mimetype.includes('spreadsheet') || req.file.originalname.match(/\.(xlsx|xls)$/)) {
      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json(sheet);
      contacts = json.map(row => ({
        phone: String(row.phone || row.number || row.Phone || row.Number || ''),
        name: String(row.name || row.Name || row.firstName || row.FirstName || ''),
        email: String(row.email || row.Email || ''),
      }));
    }

    let imported = 0;
    for (const c of contacts) {
      if (c.phone) {
        try {
          await Contact.findOneAndUpdate(
            { user: req.userId, phone: c.phone.replace(/[^0-9]/g, '') },
            {
              user: req.userId,
              phone: c.phone.replace(/[^0-9]/g, ''),
              name: c.name || '',
              email: c.email || '',
            },
            { upsert: true, new: true }
          );
          imported++;
        } catch (err) {
          logger.error('Contact import error:', err);
        }
      }
    }

    await fs.unlink(req.file.path).catch(() => {});

    if (req.xhr || req.headers.accept?.includes('json')) {
      return successResponse(res, { imported, total: contacts.length }, `${imported} contacts imported`);
    }
    req.session.success = `${imported} contacts imported successfully`;
    res.redirect('/contacts');
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return errorResponse(res, error.message, 500);
    }
    req.session.error = error.message;
    res.redirect('/contacts');
  }
};

export const exportContacts = async (req, res) => {
  try {
    const contacts = await Contact.find({ user: req.userId, isDeleted: false });

    const workbook = xlsx.utils.book_new();
    const data = contacts.map(c => ({
      Name: c.name,
      Phone: c.phone,
      Email: c.email,
      Tags: c.tags?.join(', ') || '',
      Notes: c.notes,
    }));
    const worksheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Contacts');
    const tmpFile = path.join(config.rootDir, 'tmp', `contacts_${req.userId}.xlsx`);
    await fs.mkdir(path.dirname(tmpFile), { recursive: true }).catch(() => {});
    xlsx.writeFile(workbook, tmpFile);

    res.download(tmpFile, 'contacts_export.xlsx', async () => {
      await fs.unlink(tmpFile).catch(() => {});
    });
  } catch (error) {
    errorResponse(res, error.message, 500);
  }
};

export const addTags = async (req, res) => {
  try {
    const { tags } = req.body;
    const contact = await Contact.findOne({ _id: req.params.id, user: req.userId });
    if (!contact) return errorResponse(res, 'Contact not found', 404);

    const newTags = Array.isArray(tags) ? tags : [tags];
    contact.tags = [...new Set([...contact.tags, ...newTags])];
    await contact.save();

    successResponse(res, { contact }, 'Tags added');
  } catch (error) {
    errorResponse(res, error.message, 400);
  }
};
