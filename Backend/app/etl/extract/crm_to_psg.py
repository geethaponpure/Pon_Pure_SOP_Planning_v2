from app.schemas.tables_schemas import item_master
from app.core.database import get_postgres_connection, get_sql_server_connection


def export_table_from_sql_to_psg():
    """This function is use export crm data to postgress"""

    SQL_server = get_sql_server_connection()
    SQL_cusror = SQL_server.cursor()

    for table in item_master.keys():
        columns = item_master.get(table)
        columns = ", ".join(f"[{column}]" for column in columns)

        SQL_Query = f"""
                SELECT {columns}
                FROM [CRMPROD].[dbo].[{table}]
            """

        SQL_cusror.execute(SQL_Query)

        


export_table_from_sql_to_psg()