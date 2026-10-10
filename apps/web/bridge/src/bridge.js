class Bridge {
  constructor() {
    this.tasks = new Map();
  }

  createTask(task) {
    const bridgeTask = {
      id: task.id,
      type: task.type,
      goal: task.goal,
      constraints: task.constraints || {},

      participants: task.participants || [],

      state: "BLOCKED",

      currentNeed: null,
      currentPerson: null,

      history: [],

      attempts: 0,

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(task.id, bridgeTask);

    return bridgeTask;
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  updateTask(taskId, updates) {
    const task = this.getTask(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    Object.assign(task, updates);

    task.updatedAt = new Date().toISOString();

    return task;
  }

  addHistory(taskId, entry) {
    const task = this.getTask(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.history.push({
      timestamp: new Date().toISOString(),
      ...entry
    });

    task.updatedAt = new Date().toISOString();

    return task;
  }

  setState(taskId, state) {
    return this.updateTask(taskId, {
      state
    });
  }

  setCurrentPerson(taskId, personId) {
    return this.updateTask(taskId, {
      currentPerson: personId
    });
  }

  setCurrentNeed(taskId, need) {
    return this.updateTask(taskId, {
      currentNeed: need
    });
  }
}

module.exports = Bridge;